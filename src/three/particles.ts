import * as THREE from 'three';

/** Wspólny interfejs dla systemów cząsteczek (opady, dym, mgiełka, ogień). */
export interface Updatable {
  readonly object: THREE.Object3D;
  update(dt: number, camPos: THREE.Vector3): void;
  dispose(): void;
}

export interface PointsOpts {
  count: number;
  box: { x: number; y: number; z: number };
  color: string;
  size: number;
  fall: number; // prędkość opadania [j/s]
  sway?: number; // amplituda kołysania w poziomie
  opacity?: number;
  shape?: 'drop' | 'flake';
}

let dropTex: THREE.Texture | null = null;
let flakeTex: THREE.Texture | null = null;

/** Pionowa smuga (kropla deszczu). */
function dropTexture(): THREE.Texture {
  if (dropTex) return dropTex;
  // sprite punktu jest kwadratowy, więc smuga musi być wąska w obrębie kwadratu
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(29, 4, 6, 56, 3);
  ctx.fill();
  dropTex = new THREE.CanvasTexture(c);
  return dropTex;
}

/** Miękka kropka (płatek śniegu). */
function flakeTexture(): THREE.Texture {
  if (flakeTex) return flakeTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  flakeTex = new THREE.CanvasTexture(c);
  return flakeTex;
}

/**
 * Opady: chmura punktów w pudełku, które podąża za kamerą.
 * Cząstka wychodząca poza pudełko wraca po przeciwnej stronie (recykling bez luk).
 */
export class PointsEmitter implements Updatable {
  readonly object: THREE.Points;
  private positions: Float32Array;
  private phase: Float32Array;
  private opts: PointsOpts;
  private t = 0;

  constructor(opts: PointsOpts) {
    this.opts = opts;
    const { count, box } = opts;
    this.positions = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * box.x;
      this.positions[i * 3 + 1] = Math.random() * box.y;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * box.z;
      this.phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: opts.color,
      size: opts.size,
      map: opts.shape === 'drop' ? dropTexture() : opts.shape === 'flake' ? flakeTexture() : null,
      alphaTest: 0.02,
      sizeAttenuation: true,
      transparent: true,
      opacity: opts.opacity ?? 0.6,
      depthWrite: false,
    });
    this.object = new THREE.Points(geo, mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
  }

  update(dt: number, camPos: THREE.Vector3) {
    this.t += dt;
    const { count, box, fall } = this.opts;
    const sway = this.opts.sway ?? 0;
    const p = this.positions;
    const halfX = box.x / 2;
    const halfZ = box.z / 2;
    const topY = camPos.y + box.y * 0.6;
    const botY = camPos.y - box.y * 0.4;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      p[i3 + 1] -= fall * dt;
      if (sway > 0) {
        p[i3] += Math.sin(this.t * 1.3 + this.phase[i]) * sway * dt;
        p[i3 + 2] += Math.cos(this.t * 1.1 + this.phase[i]) * sway * dt;
      }
      if (p[i3 + 1] < botY) p[i3 + 1] = topY;
      const dx = p[i3] - camPos.x;
      if (dx > halfX) p[i3] -= box.x;
      else if (dx < -halfX) p[i3] += box.x;
      const dz = p[i3 + 2] - camPos.z;
      if (dz > halfZ) p[i3 + 2] -= box.z;
      else if (dz < -halfZ) p[i3 + 2] += box.z;
    }
    (this.object.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.object.removeFromParent();
  }
}

export interface PuffOpts {
  count: number;
  origin: [number, number, number];
  radius: number; // rozrzut startowy
  rise: number; // prędkość wznoszenia
  life: number; // czas życia cząstki [s]
  scaleFrom: number;
  scaleTo: number;
  color: string;
  opacity?: number;
  drift?: [number, number]; // stały dryf w poziomie
  emissive?: string; // żar (oddech smoka, nie dym)
}

const puffGeo = new THREE.IcosahedronGeometry(1, 0);

/** Kłęby: dym wulkanu, mgiełka wodospadu, chmury. */
export class PuffEmitter implements Updatable {
  readonly object: THREE.InstancedMesh;
  private age: Float32Array;
  private seed: Float32Array;
  private opts: PuffOpts;
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(opts: PuffOpts) {
    this.opts = opts;
    const mat = new THREE.MeshStandardMaterial({
      color: opts.color,
      transparent: true,
      opacity: opts.opacity ?? 0.55,
      roughness: 1,
      flatShading: true,
      depthWrite: false,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveIntensity: opts.emissive ? 1.4 : 0,
    });
    this.object = new THREE.InstancedMesh(puffGeo, mat, opts.count);
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.object.castShadow = false;
    this.object.receiveShadow = false;
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;
    this.age = new Float32Array(opts.count);
    this.seed = new Float32Array(opts.count * 2);
    for (let i = 0; i < opts.count; i++) {
      this.age[i] = (i / opts.count) * opts.life;
      this.seed[i * 2] = Math.random() * Math.PI * 2;
      this.seed[i * 2 + 1] = 0.6 + Math.random() * 0.8;
    }
    this.writeMatrices();
  }

  private writeMatrices() {
    const o = this.opts;
    for (let i = 0; i < o.count; i++) {
      const t = this.age[i] / o.life;
      const a = this.seed[i * 2];
      const r = this.seed[i * 2 + 1];
      const x = o.origin[0] + Math.cos(a) * o.radius * r + (o.drift?.[0] ?? 0) * this.age[i];
      const y = o.origin[1] + o.rise * this.age[i];
      const z = o.origin[2] + Math.sin(a) * o.radius * r + (o.drift?.[1] ?? 0) * this.age[i];
      const sc = (o.scaleFrom + (o.scaleTo - o.scaleFrom) * t) * r;
      this.v.set(x, y, z);
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      this.s.setScalar(Math.max(sc, 0.001));
      this.m.compose(this.v, this.q, this.s);
      this.object.setMatrixAt(i, this.m);
    }
    this.object.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, _camPos: THREE.Vector3) {
    void _camPos;
    const o = this.opts;
    for (let i = 0; i < o.count; i++) {
      this.age[i] += dt;
      if (this.age[i] > o.life) {
        this.age[i] = 0;
        this.seed[i * 2] = Math.random() * Math.PI * 2;
        this.seed[i * 2 + 1] = 0.6 + Math.random() * 0.8;
      }
    }
    this.writeMatrices();
  }

  dispose() {
    (this.object.material as THREE.Material).dispose();
    this.object.dispose();
    this.object.removeFromParent();
  }
}

export interface SwarmOpts {
  count: number;
  /** Środek roju w lokalnych współrzędnych obiektu i promień w poziomie. */
  origin: [number, number, number];
  radius: number;
  height: number;
  kind: 'firefly' | 'butterfly' | 'insect';
  colors: string[];
  size: number;
  speed: number;
}

let glowTex: THREE.Texture | null = null;
let wingTex: THREE.Texture | null = null;

/** Miękki punkt światła (świetlik). */
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** Dwa skrzydła z ciemnym tułowiem (motyl) — biały, barwiony kolorem punktu. */
function wingTexture(): THREE.Texture {
  if (wingTex) return wingTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(32 + sgn * 14, 24, 13, 16, sgn * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(32 + sgn * 11, 44, 9, 11, -sgn * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#332b28';
  ctx.beginPath();
  ctx.ellipse(32, 34, 3, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  wingTex = new THREE.CanvasTexture(c);
  return wingTex;
}

/**
 * Rój: punkty krążące wokół własnych kotwic w walcu nad obiektem (świetliki, motyle). Każdy punkt ma
 * własną fazę, więc trajektorie się nie powtarzają; świetliki mrugają przez kolor (mieszanie addytywne).
 */
export class SwarmEmitter implements Updatable {
  readonly object: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private base: Float32Array;
  private anchors: Float32Array;
  private phase: Float32Array;
  private opts: SwarmOpts;
  private t = Math.random() * 100;

  constructor(opts: SwarmOpts) {
    this.opts = opts;
    const n = opts.count;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.anchors = new Float32Array(n * 3);
    this.phase = new Float32Array(n * 4);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * opts.radius;
      this.anchors[i * 3] = opts.origin[0] + Math.cos(a) * r;
      this.anchors[i * 3 + 1] = opts.origin[1] + Math.random() * opts.height;
      this.anchors[i * 3 + 2] = opts.origin[2] + Math.sin(a) * r;
      for (let k = 0; k < 4; k++) this.phase[i * 4 + k] = Math.random() * Math.PI * 2;
      col.set(opts.colors[i % opts.colors.length]);
      this.base[i * 3] = col.r;
      this.base[i * 3 + 1] = col.g;
      this.base[i * 3 + 2] = col.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const firefly = opts.kind === 'firefly';
    const material = new THREE.PointsMaterial({
      size: opts.size,
      // owady to małe ciemne kropki (miękki punkt bez blasku), motyle sprite skrzydeł
      map: opts.kind === 'butterfly' ? wingTexture() : glowTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: firefly ? THREE.AdditiveBlending : THREE.NormalBlending,
      alphaTest: firefly ? 0 : opts.kind === 'insect' ? 0.5 : 0.4,
      sizeAttenuation: true,
    });
    this.object = new THREE.Points(geo, material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
    this.write();
  }

  private write() {
    const o = this.opts;
    const t = this.t;
    const firefly = o.kind === 'firefly';
    const insect = o.kind === 'insect';
    for (let i = 0; i < o.count; i++) {
      const p0 = this.phase[i * 4];
      const p1 = this.phase[i * 4 + 1];
      const p2 = this.phase[i * 4 + 2];
      const p3 = this.phase[i * 4 + 3];
      // wędrówka wokół kotwicy: dwa niewspółmierne okresy na osi, żeby tor nie był kołem
      // owady bzyczą szybko i nerwowo blisko kotwicy, reszta wędruje szerzej i spokojniej
      const wander = firefly ? 0.6 : insect ? 0.35 : 0.9;
      const jitter = insect ? 0.12 : 0.15;
      const fast = insect ? 4 : 1;
      this.positions[i * 3] = this.anchors[i * 3] + Math.sin(t * 0.7 * fast + p0) * wander + Math.sin(t * 1.9 * fast + p1) * jitter;
      this.positions[i * 3 + 1] = this.anchors[i * 3 + 1] + Math.sin(t * 0.9 * fast + p2) * (firefly ? 0.25 : insect ? 0.2 : 0.4) + (firefly || insect ? 0 : Math.abs(Math.sin(t * 9 + p3)) * 0.05);
      this.positions[i * 3 + 2] = this.anchors[i * 3 + 2] + Math.cos(t * 0.6 * fast + p1) * wander + Math.cos(t * 2.3 * fast + p3) * jitter;
      // świetlik mruga (krótkie błyski), motyl tylko lekko ciemnieje przy złożonych skrzydłach, owad ma stały kolor
      const blink = firefly ? Math.max(0, Math.sin(t * 2.2 + p3) - 0.55) / 0.45 : insect ? 1 : 0.75 + 0.25 * Math.abs(Math.sin(t * 9 + p3));
      const k = firefly ? 0.15 + blink : blink;
      this.colors[i * 3] = this.base[i * 3] * k;
      this.colors[i * 3 + 1] = this.base[i * 3 + 1] * k;
      this.colors[i * 3 + 2] = this.base[i * 3 + 2] * k;
    }
    const geo = this.object.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number, _camPos: THREE.Vector3) {
    void _camPos;
    this.t += dt * this.opts.speed;
    this.write();
  }

  dispose() {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.object.removeFromParent();
  }
}
