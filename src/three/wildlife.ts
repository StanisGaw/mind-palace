import * as THREE from 'three';
import { mat } from './builders';
import { PuffEmitter, type Updatable } from './particles';

export type AnimalKind = 'bird' | 'dog' | 'cat' | 'squirrel' | 'wolf' | 'dragon';

export interface SpawnInfo {
  id: string;
  kind: AnimalKind;
  pos: THREE.Vector3;
}

export interface WorldInfo {
  /** Przeszkody w poziomie: środek i promień. */
  obstacles: { x: number; z: number; r: number }[];
  /** Miejsca, na których zwierzę może usiąść (korona drzewa, dach, ławka). */
  perches: { x: number; y: number; z: number; kind: 'tree' | 'roof' | 'seat' }[];
  heightAt: (x: number, z: number) => number;
  clamp: (x: number, z: number) => [number, number];
}

const COLORS: Record<AnimalKind, { body: string; dark: string; accent: string }> = {
  bird: { body: '#5d6f8a', dark: '#3f4d61', accent: '#e0a24a' },
  dog: { body: '#c0895a', dark: '#8d6340', accent: '#f3e6d4' },
  cat: { body: '#7b7d86', dark: '#5a5c64', accent: '#f0efe9' },
  squirrel: { body: '#b4623a', dark: '#8a482a', accent: '#e8d9c4' },
  wolf: { body: '#8b8f96', dark: '#61656c', accent: '#d8dbe0' },
  dragon: { body: '#2a2438', dark: '#1a1524', accent: '#c4a574' },
};

/** Rozmiar zwierzęcia względem psa (przybliżona długość ciała w metrach). */
const SIZES: Record<AnimalKind, number> = { bird: 0.28, dog: 0.9, cat: 0.6, squirrel: 0.34, wolf: 1.25, dragon: 4.2 };

export const ANIMAL_LABELS: Record<AnimalKind, string> = {
  bird: 'Ptaki',
  dog: 'Pies',
  cat: 'Kot',
  squirrel: 'Wiewiórka',
  wolf: 'Wilk',
  dragon: 'Smok',
};

interface Parts {
  group: THREE.Group;
  legs: THREE.Object3D[];
  wings: THREE.Object3D[];
  tail: THREE.Object3D | null;
  head: THREE.Object3D | null;
  /** Materiały niepochodzące z mat() — do zwolnienia w Creature.dispose. */
  ownMaterials?: THREE.Material[];
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cone = (r: number, h: number, seg = 4) => new THREE.ConeGeometry(r, h, seg);

let scaleTexDark: THREE.CanvasTexture | null = null;
let scaleTexBelly: THREE.CanvasTexture | null = null;

/** Rombowe łuski na canvasie — wspólna mapa, bez zwalniania per smok. */
function dragonScaleMap(kind: 'dark' | 'belly'): THREE.CanvasTexture {
  if (kind === 'dark' && scaleTexDark) return scaleTexDark;
  if (kind === 'belly' && scaleTexBelly) return scaleTexBelly;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const base = kind === 'belly' ? '#e8d4a0' : '#3d3458';
  const hi = kind === 'belly' ? '#f7edd0' : '#5a4f78';
  const line = kind === 'belly' ? '#b8925a' : '#1e1830';
  const shade = kind === 'belly' ? '#d4bc82' : '#2a243f';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const cell = 16;
  for (let row = -1; row < size / cell + 2; row++) {
    for (let col = -1; col < size / cell + 2; col++) {
      const ox = col * cell + (row % 2 === 0 ? 0 : cell / 2);
      const oy = row * cell * 0.72;
      const variant = (row + col) % 3;
      ctx.fillStyle = variant === 0 ? hi : variant === 1 ? shade : base;
      ctx.beginPath();
      ctx.moveTo(ox + cell / 2, oy + 1);
      ctx.lineTo(ox + cell - 1, oy + cell * 0.45);
      ctx.lineTo(ox + cell / 2, oy + cell * 0.9);
      ctx.lineTo(ox + 1, oy + cell * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (kind === 'dark') scaleTexDark = tex;
  else scaleTexBelly = tex;
  return tex;
}

/** Smok w stylu fantasy: ciemny grzbiet, jasny brzuch, kolce, membrana skrzydeł. */
function buildDragonBody(): Parts {
  const g = new THREE.Group();
  const own: THREE.Material[] = [];
  const legs: THREE.Object3D[] = [];
  const wings: THREE.Object3D[] = [];
  const mk = (
    color: string,
    opts: {
      map?: THREE.Texture;
      emissive?: string;
      roughness?: number;
      transparent?: boolean;
      opacity?: number;
      side?: THREE.Side;
      repeat?: number;
    } = {},
  ): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      color,
      map: opts.map ?? null,
      roughness: opts.roughness ?? 0.78,
      metalness: 0.05,
      flatShading: true,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      depthWrite: opts.transparent ? false : true,
    });
    if (opts.map) {
      m.map!.repeat.set(opts.repeat ?? 2.2, opts.repeat ?? 2.2);
      m.needsUpdate = true;
    }
    own.push(m);
    return m;
  };
  const dorsal = mk('#ffffff', { map: dragonScaleMap('dark') });
  const belly = mk('#ffffff', { map: dragonScaleMap('belly'), roughness: 0.7, repeat: 1.6 });
  const bone = mk('#c4a574', { roughness: 0.55 });
  const claw = mk('#1a1520');
  const membrane = mk('#4a1830', {
    emissive: '#c42a55',
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    roughness: 0.95,
  });
  // emissiveIntensity osobno — mk nie ustawia, więc po utworzeniu
  membrane.emissiveIntensity = 0.45;
  const glowEdge = mk('#ff8a3a', { emissive: '#ff6a20' });
  glowEdge.emissiveIntensity = 0.85;
  const eye = mk('#ff5a2a', { emissive: '#ff3a00' });
  eye.emissiveIntensity = 1.2;
  const addM = (
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = g,
    cast = true,
  ) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    parent.add(mesh);
    return mesh;
  };

  addM(box(0.95, 0.72, 2.4), dorsal, 0, 0.08, 0);
  addM(box(0.78, 0.38, 2.15), belly, 0, -0.28, 0.05);
  addM(box(0.62, 0.5, 0.7), dorsal, 0, 0.22, -1.45);
  addM(box(0.48, 0.28, 0.55), belly, 0, -0.02, -1.5);
  addM(box(0.52, 0.42, 0.55), dorsal, 0, 0.32, -1.95);
  const head = addM(box(0.48, 0.4, 0.72), dorsal, 0, 0.38, -2.45);
  addM(box(0.36, 0.2, 0.5), belly, 0, 0.18, -2.5);
  addM(box(0.22, 0.12, 0.28), belly, 0, 0.22, -2.85);
  addM(box(0.08, 0.08, 0.08), eye, -0.16, 0.5, -2.55);
  addM(box(0.08, 0.08, 0.08), eye, 0.16, 0.5, -2.55);
  for (const s of [-1, 1]) {
    const horn = addM(cone(0.09, 0.42, 5), bone, s * 0.18, 0.72, -2.25);
    horn.rotation.x = -0.55;
    horn.rotation.z = s * 0.25;
    const horn2 = addM(cone(0.06, 0.28, 4), bone, s * 0.28, 0.55, -2.15);
    horn2.rotation.x = -0.35;
    horn2.rotation.z = s * 0.55;
  }
  const spineZs = [-2.1, -1.55, -1.0, -0.4, 0.2, 0.8, 1.4, 2.0, 2.55, 3.1];
  spineZs.forEach((z, i) => {
    const h = 0.38 - i * 0.022;
    const sp = addM(cone(0.08, h, 4), bone, 0, 0.48 + h * 0.15, z);
    sp.rotation.x = 0.15;
  });
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.05, 1.15);
  g.add(tailPivot);
  addM(box(0.42, 0.38, 1.1), dorsal, 0, 0, 0.55, tailPivot);
  addM(box(0.32, 0.2, 0.95), belly, 0, -0.18, 0.55, tailPivot);
  addM(box(0.28, 0.26, 1.0), dorsal, 0, -0.02, 1.45, tailPivot);
  addM(box(0.16, 0.14, 0.9), dorsal, 0, -0.04, 2.25, tailPivot);
  addM(box(0.22, 0.05, 0.35), bone, 0, 0.02, 2.75, tailPivot);
  for (const s of [-1, 1] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.42, 0.35, -0.15);
    g.add(pivot);
    wings.push(pivot);
    addM(box(1.5, 0.1, 0.14), dorsal, (s * 1.5) / 2, 0.05, -0.05, pivot);
    addM(box(1.1, 0.08, 0.1), dorsal, (s * 1.9) / 2, -0.05, 0.55, pivot);
    addM(box(0.9, 0.07, 0.08), dorsal, (s * 2.1) / 2, -0.15, 1.05, pivot);
    const tip = addM(cone(0.07, 0.22, 4), bone, s * 2.55, 0.08, -0.1, pivot, false);
    tip.rotation.z = s * -1.2;
    const mem = addM(box(2.4, 0.04, 1.55), membrane, (s * 2.4) / 2, -0.08, 0.45, pivot, false);
    mem.rotation.x = 0.12;
    addM(box(2.35, 0.02, 0.06), glowEdge, (s * 2.35) / 2, -0.1, 1.15, pivot, false);
  }
  for (const [x, z, front] of [
    [-0.38, -0.75, true],
    [0.38, -0.75, true],
    [-0.4, 0.75, false],
    [0.4, 0.75, false],
  ] as [number, number, boolean][]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.25, z);
    g.add(pivot);
    legs.push(pivot);
    const len = front ? 0.65 : 0.75;
    addM(box(0.22, len, 0.24), dorsal, 0, -len / 2, 0, pivot);
    addM(box(0.32, 0.1, 0.36), claw, 0, -len - 0.02, -0.05, pivot);
    for (const t of [-0.1, 0, 0.1]) addM(box(0.06, 0.08, 0.14), claw, t, -len - 0.08, -0.22, pivot);
  }
  return { group: g, legs, wings, tail: tailPivot, head, ownMaterials: own };
}

/** Proceduralne, low-poly ciało zwierzęcia. Jednostka: metry, przód w −Z. */
export function buildAnimalBody(kind: AnimalKind): Parts {
  if (kind === 'dragon') return buildDragonBody();

  const g = new THREE.Group();
  const c = COLORS[kind];
  const legs: THREE.Object3D[] = [];
  const wings: THREE.Object3D[] = [];
  let tail: THREE.Object3D | null = null;
  let head: THREE.Object3D | null = null;
  const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  if (kind === 'bird') {
    add(box(0.16, 0.14, 0.3), c.body, 0, 0, 0);
    head = add(box(0.12, 0.12, 0.12), c.dark, 0, 0.08, -0.18);
    add(box(0.05, 0.04, 0.09), c.accent, 0, 0.07, -0.27);
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.07, 0.04, 0);
      const w = add(box(0.34, 0.03, 0.2), c.dark, (s * 0.34) / 2, 0, 0, pivot);
      w.castShadow = false;
      g.add(pivot);
      wings.push(pivot);
    }
    tail = add(box(0.12, 0.03, 0.16), c.dark, 0, 0.02, 0.2);
  } else {
    // czworonogi: pies, kot, wiewiórka, wilk
    const L = SIZES[kind];
    const h = L * 0.42;
    add(box(L * 0.42, h, L), c.body, 0, 0, 0);
    add(box(L * 0.36, h * 0.9, L * 0.3), c.dark, 0, h * 0.1, -L * 0.5);
    head = add(box(L * 0.3, L * 0.28, L * 0.32), c.dark, 0, h * 0.55, -L * 0.62);
    add(box(L * 0.1, L * 0.12, L * 0.1), c.accent, -L * 0.09, h * 0.95, -L * 0.6);
    add(box(L * 0.1, L * 0.12, L * 0.1), c.accent, L * 0.09, h * 0.95, -L * 0.6);
    add(box(L * 0.12, L * 0.1, L * 0.12), c.accent, 0, h * 0.42, -L * 0.78);
    const legLen = L * (kind === 'squirrel' ? 0.3 : 0.55);
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as [number, number][]) {
      const pivot = new THREE.Group();
      pivot.position.set(x * L * 0.17, -h * 0.35, z * L * 0.32);
      add(box(L * 0.12, legLen, L * 0.12), c.dark, 0, -legLen / 2, 0, pivot);
      g.add(pivot);
      legs.push(pivot);
    }
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, h * 0.2, L * 0.5);
    if (kind === 'squirrel') add(box(L * 0.3, L * 0.7, L * 0.2), c.body, 0, L * 0.32, L * 0.06, tailPivot);
    else add(box(L * 0.12, L * 0.12, L * 0.55), c.body, 0, L * 0.06, L * 0.26, tailPivot);
    g.add(tailPivot);
    tail = tailPivot;
    g.position.y = legLen + h * 0.35;
  }
  return { group: g, legs, wings, tail, head };
}

type State = 'wander' | 'approach' | 'sit' | 'flee' | 'perch' | 'climb' | 'circle' | 'patrol' | 'growl' | 'swoop' | 'react';

class Creature {
  readonly spawnId: string;
  readonly kind: AnimalKind;
  readonly group: THREE.Group;
  readonly home = new THREE.Vector3();
  private parts: Parts;
  private target = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private phase = Math.random() * 10;
  private timer = 0;
  private reactTimer = 0;
  state: State = 'wander';
  private flying: boolean;
  private emitter: Updatable | null = null;

  constructor(spawnId: string, kind: AnimalKind, home: THREE.Vector3, index: number) {
    this.spawnId = spawnId;
    this.kind = kind;
    this.home.copy(home);
    this.flying = kind === 'bird' || kind === 'dragon';
    this.parts = buildAnimalBody(kind);
    this.group = new THREE.Group();
    this.group.add(this.parts.group);
    this.group.position.copy(home);
    if (this.flying) this.group.position.y = home.y + (kind === 'dragon' ? 16 : 5) + index * 0.7;
    this.group.userData.objectId = spawnId;
    this.group.traverse((c) => (c.userData.objectId = spawnId));
    this.state = this.flying ? 'circle' : kind === 'wolf' ? 'patrol' : 'wander';
    this.phase += index;
    if (kind === 'dragon') {
      // oddech: suchy ogień do przodu (−Z), nie kłąb dymu w górę
      this.emitter = new PuffEmitter({
        count: 14,
        origin: [0, 0.22, -2.9],
        radius: 0.1,
        rise: 0.12,
        life: 0.65,
        scaleFrom: 0.07,
        scaleTo: 0.42,
        color: '#ff7a28',
        emissive: '#ff3a00',
        opacity: 0,
        drift: [0, -2.4],
      });
      this.parts.group.add(this.emitter.object);
    }
  }

  private pickWander(world: WorldInfo) {
    const r = this.kind === 'wolf' ? 8 : 6;
    const a = Math.random() * Math.PI * 2;
    const d = 1.5 + Math.random() * r;
    const [x, z] = world.clamp(this.home.x + Math.cos(a) * d, this.home.z + Math.sin(a) * d);
    this.target.set(x, 0, z);
    this.timer = 2 + Math.random() * 3;
  }

  /** Reakcja na kliknięcie/dotknięcie. */
  poke() {
    this.reactTimer = this.kind === 'dragon' ? 2.2 : 1.2;
    this.state = 'react';
  }

  get position() {
    return this.group.position;
  }

  update(dt: number, player: THREE.Vector3, world: WorldInfo) {
    this.phase += dt;
    const p = this.group.position;
    const distToPlayer = Math.hypot(player.x - p.x, player.z - p.z);
    let speed = 0;

    if (this.reactTimer > 0) {
      this.reactTimer -= dt;
      if (this.reactTimer <= 0) this.state = this.flying ? 'circle' : this.kind === 'wolf' ? 'patrol' : 'wander';
    }

    if (this.flying) {
      // ptaki i smok krążą; smok co jakiś czas nadlatuje nad gracza
      const big = this.kind === 'dragon';
      const radius = big ? 24 : 5 + (this.phase % 3);
      const height = big ? 16 : 5.5;
      this.timer -= dt;
      if (big && this.timer <= 0) {
        this.state = this.state === 'swoop' ? 'circle' : 'swoop';
        this.timer = this.state === 'swoop' ? 9 : 22 + Math.random() * 16;
      }
      const center = this.state === 'swoop' ? player : this.home;
      const w = this.phase * (big ? 0.16 : 0.5);
      const rr = this.state === 'swoop' ? 9 : radius;
      const hh = this.state === 'swoop' ? 7 : height;
      this.target.set(center.x + Math.cos(w) * rr, world.heightAt(center.x, center.z) + hh + Math.sin(this.phase * 0.7) * 0.8, center.z + Math.sin(w) * rr);
      const dir = this.target.clone().sub(p);
      speed = Math.min(dir.length(), big ? 7 : 3.4);
      if (dir.lengthSq() > 1e-4) {
        dir.normalize();
        this.vel.lerp(dir.multiplyScalar(speed), 1 - Math.exp(-dt * 2));
        p.addScaledVector(this.vel, dt);
      }
      const flap = Math.sin(this.phase * (big ? 3 : 12));
      for (const w2 of this.parts.wings) w2.rotation.z = flap * (big ? 0.35 : 0.9) * (w2.position.x < 0 ? -1 : 1);
      if (big && this.parts.tail) {
        this.parts.tail.rotation.y = Math.sin(this.phase * 1.4) * 0.18;
        this.parts.tail.rotation.x = Math.sin(this.phase * 0.9) * 0.08;
      }
      if (this.emitter) {
        const m = this.emitter.object as THREE.InstancedMesh;
        (m.material as THREE.MeshStandardMaterial).opacity = this.reactTimer > 0 || this.state === 'swoop' ? 0.75 : 0;
      }
    } else {
      // czworonogi: chód po ziemi
      this.timer -= dt;
      switch (this.kind) {
        case 'dog':
          if (distToPlayer < 5 && this.reactTimer <= 0) this.state = distToPlayer < 2.6 ? 'sit' : 'approach';
          else if (this.state !== 'react' && this.timer <= 0) {
            this.state = 'wander';
            this.pickWander(world);
          }
          break;
        case 'cat':
          if (distToPlayer < 2.5) {
            this.state = 'flee';
            const away = new THREE.Vector3(p.x - player.x, 0, p.z - player.z).normalize().multiplyScalar(6);
            const [cx, cz] = world.clamp(p.x + away.x, p.z + away.z);
            this.target.set(cx, 0, cz);
            this.timer = 2;
          } else if (this.timer <= 0) {
            this.state = 'wander';
            this.pickWander(world);
          }
          break;
        case 'squirrel': {
          const tree = world.perches.filter((q) => q.kind === 'tree');
          if (distToPlayer < 3 && tree.length > 0) {
            this.state = 'climb';
            const t = tree[Math.floor(this.phase) % tree.length];
            this.target.set(t.x, t.y, t.z);
          } else if (this.timer <= 0) {
            this.state = 'wander';
            if (tree.length > 0 && Math.random() < 0.6) {
              const t = tree[Math.floor(Math.random() * tree.length)];
              this.target.set(t.x + (Math.random() - 0.5) * 2, 0, t.z + (Math.random() - 0.5) * 2);
              this.timer = 3;
            } else this.pickWander(world);
          }
          break;
        }
        case 'wolf':
          if (distToPlayer < 4) {
            this.state = 'growl';
            const keep = 2;
            const dir = new THREE.Vector3(p.x - player.x, 0, p.z - player.z).normalize().multiplyScalar(keep);
            this.target.set(player.x + dir.x, 0, player.z + dir.z);
          } else if (this.timer <= 0) {
            this.state = 'patrol';
            this.pickWander(world);
          }
          break;
        default:
          if (this.timer <= 0) this.pickWander(world);
      }
      if (this.state === 'approach') this.target.set(player.x, 0, player.z);
      if (this.state === 'sit' || this.state === 'react') {
        this.vel.multiplyScalar(1 - Math.min(1, dt * 8));
      }
      const climbing = this.state === 'climb';
      const dir = new THREE.Vector3(this.target.x - p.x, 0, this.target.z - p.z);
      const dist = dir.length();
      const maxSpeed = this.state === 'flee' ? 5 : this.state === 'growl' ? 1.2 : this.state === 'approach' ? 3 : this.kind === 'squirrel' ? 3.4 : 1.9;
      if (dist > 0.35 && this.state !== 'sit' && this.state !== 'react') {
        dir.normalize();
        // omijanie przeszkód
        for (const o of world.obstacles) {
          const dx = p.x - o.x;
          const dz = p.z - o.z;
          const d = Math.hypot(dx, dz);
          if (d < o.r + 0.6 && d > 1e-3) dir.add(new THREE.Vector3(dx / d, 0, dz / d).multiplyScalar((o.r + 0.6 - d) * 1.5));
        }
        dir.normalize();
        this.vel.lerp(dir.multiplyScalar(maxSpeed), 1 - Math.exp(-dt * 5));
      } else if (this.state !== 'climb') this.vel.multiplyScalar(1 - Math.min(1, dt * 6));
      const [nx, nz] = world.clamp(p.x + this.vel.x * dt, p.z + this.vel.z * dt);
      p.x = nx;
      p.z = nz;
      speed = Math.hypot(this.vel.x, this.vel.z);
      const groundY = world.heightAt(p.x, p.z);
      if (climbing && dist < 1.2) p.y += (this.target.y - p.y) * Math.min(1, dt * 2);
      else p.y += (groundY - p.y) * Math.min(1, dt * 8);
      // animacja nóg i ogona
      const gait = Math.sin(this.phase * (4 + speed * 2));
      this.parts.legs.forEach((l, i) => (l.rotation.x = gait * 0.5 * Math.min(1, speed) * (i % 2 === 0 ? 1 : -1)));
      this.parts.group.position.y = (this.parts.group.userData.baseY ?? (this.parts.group.userData.baseY = this.parts.group.position.y)) + Math.abs(gait) * 0.03 * Math.min(1, speed);
      if (this.parts.tail) {
        const wag = this.state === 'sit' || this.state === 'react' ? 4 : 1.5;
        this.parts.tail.rotation.y = Math.sin(this.phase * (2 + wag)) * (this.kind === 'dog' ? 0.55 : 0.25);
      }
      if (this.parts.head) this.parts.head.rotation.x = this.state === 'growl' ? -0.15 : this.state === 'react' ? Math.sin(this.phase * 9) * 0.2 : 0;
    }

    // obrót w kierunku ruchu
    if (this.vel.lengthSq() > 0.02) {
      const want = Math.atan2(this.vel.x, this.vel.z) + Math.PI;
      let d = want - this.group.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.group.rotation.y += d * Math.min(1, dt * 5);
    }
    this.emitter?.update(dt, player);
  }

  dispose() {
    this.emitter?.dispose();
    this.group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    // wspólne materiały smoka — raz, nie przy każdym meshu
    for (const m of this.parts.ownMaterials ?? []) m.dispose();
    this.group.removeFromParent();
  }
}

const MAX_CREATURES = 20;
const FLOCK: Partial<Record<AnimalKind, number>> = { bird: 6 };

/** Zwierzęta ożywają w trybie chodzenia; w edytorze widać tylko punkty pojawiania. */
export class Wildlife {
  private scene: THREE.Scene;
  creatures: Creature[] = [];
  private key = '';

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Buduje zwierzęta dla podanych punktów (pusta lista = wszystko znika). */
  sync(spawns: SpawnInfo[], world: WorldInfo) {
    const key = spawns.map((s) => `${s.id}:${s.kind}:${s.pos.x.toFixed(1)},${s.pos.z.toFixed(1)}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.clear();
    for (const s of spawns) {
      const count = FLOCK[s.kind] ?? 1;
      for (let i = 0; i < count; i++) {
        if (this.creatures.length >= MAX_CREATURES) break;
        const home = s.pos.clone();
        home.y = world.heightAt(home.x, home.z);
        const c = new Creature(s.id, s.kind, home, i);
        this.creatures.push(c);
        this.scene.add(c.group);
      }
    }
  }

  update(dt: number, player: THREE.Vector3, world: WorldInfo) {
    for (const c of this.creatures) c.update(dt, player, world);
  }

  pickables(): THREE.Object3D[] {
    return this.creatures.map((c) => c.group);
  }

  poke(spawnId: string): boolean {
    let hit = false;
    for (const c of this.creatures) {
      if (c.spawnId === spawnId) {
        c.poke();
        hit = true;
      }
    }
    return hit;
  }

  /** Pozycja pierwszego zwierzęcia z danego punktu (do panelu z notatką). */
  positionOf(spawnId: string): THREE.Vector3 | null {
    const c = this.creatures.find((x) => x.spawnId === spawnId);
    return c ? c.position : null;
  }

  private clear() {
    for (const c of this.creatures) c.dispose();
    this.creatures = [];
  }

  dispose() {
    this.clear();
    this.key = '';
  }
}
