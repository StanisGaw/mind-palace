import * as THREE from 'three';
import { buildAnimalBody, type AnimalKind } from './wildlife';
import { DOOR_OPENING, FACADE, SHELLS, SHELL_WALL_T, TOWER_R, WALL_SEGMENT, WALL_THICKNESS, facadeWallsOf, shellFixedBoxes, shellWindowHoles, type FacadeWall, type Opening, type ShellSpec, type WallHole } from '../lib/rooms';
import { subtractRect, type Rect } from '../lib/rects';
import { paintingTexture } from './art';
import { Noise2D } from './noise';
import { grainTexture, maxAnisotropy, textureById } from './textures';
import { MATERIAL_DEFAULTS, MATERIAL_ROLES, paletteOf, type MaterialRole } from '../lib/materials';
import type { MountId } from '../lib/ride';
import { assetLoaded, cloneAsset } from './assets';

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export interface MatOpts {
  emissive?: string;
  roughness?: number;
  metalness?: number;
  flat?: boolean;
  /** Tekstura mnożona przez kolor (słoje drewna, wykończenie podłogi) — klucz cache bierze jej uuid. */
  map?: THREE.Texture;
  /** Poniżej 1 materiał jest przezroczysty (szyby). */
  opacity?: number;
}
export function mat(color: string, opts: MatOpts = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.roughness ?? 0.85}|${opts.metalness ?? 0}|${opts.flat ?? true}|${opts.map?.uuid ?? ''}|${opts.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0,
      flatShading: opts.flat ?? true,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      map: opts.map ?? null,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

/** Drewno ze słojami: jasna tekstura słojów mnożona przez kolor warstwy. */
export function woodMat(color: string, opts: MatOpts = {}) {
  return mat(color, { ...opts, map: grainTexture() });
}

/** Szyba: przezroczysta, gładka; jeden współdzielony materiał na kolor palety. */
export function glassMat() {
  return mat(C.glass, { roughness: 0.1, metalness: 0.2, flat: false, opacity: 0.35 });
}

/**
 * Wykończenie powierzchni: tekstura o id `id` (wbudowana albo własna) albo sam kolor, gdy jej brak.
 * `tint` mnoży fakturę przez kolor warstwy zamiast przez biel — na elewacji kolor budynku ma zostać widoczny,
 * bo to on odróżnia od siebie bryły w scenie.
 */
export function finishMat(id: string | undefined, color: string, opts: MatOpts & { tint?: boolean } = {}) {
  const { tint, ...rest } = opts;
  const tex = textureById(id);
  return tex ? mat(tint ? color : '#ffffff', { ...rest, flat: false, map: tex }) : mat(color, rest);
}

/**
 * Skaluje UV geometrii tak, by kafel tekstury powtarzał się co `tile` jednostek (pudełka mają UV 0..1 na
 * ścianę). `ou`/`ov` przesuwają wzór, żeby sąsiednie płyty stropu miały wspólną siatkę kafli.
 */
export function scaleUv(geo: THREE.BufferGeometry, su: number, sv: number, ou = 0, ov = 0) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  uv.needsUpdate = true;
  return geo;
}

/**
 * Paleta warstw: odczyt `C.rola` zwraca kolor bieżącej palety (domyślna albo nadpisana przez obiekt) i notuje,
 * że model tej warstwy używa — panel pokazuje tylko warstwy obecne w modelu. Budowa jest synchroniczna,
 * więc paleta ustawiona w `buildModel` nie miesza się między obiektami.
 */
let palette: Record<MaterialRole, string> = MATERIAL_DEFAULTS;
let usedRoles = new Set<MaterialRole>();
const C = {} as Readonly<Record<MaterialRole, string>>;
for (const role of MATERIAL_ROLES) {
  Object.defineProperty(C, role, {
    enumerable: true,
    get: () => {
      usedRoles.add(role);
      return palette[role];
    },
  });
}

/** Poniżej tej największej rozpiętości bryłka nie rzuca cienia: przy słońcu wysoko cień świecznika
 *  czy talerza jest mniejszy od piksela mapy cienia, a każda taka siatka to drugie wywołanie rysowania. */
const SHADOW_MIN = 0.35;

function add(group: THREE.Group, geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, rot?: [number, number, number]) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  m.castShadow = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) >= SHADOW_MIN;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const sphere = (r: number, seg = 10) => new THREE.SphereGeometry(r, seg, seg);
const dodeca = (r: number, detail = 0) => new THREE.DodecahedronGeometry(r, detail);

/** Trójkątny graniastosłup (dach). Szerokość w (oś X), wysokość h, głębokość d (oś Z). */
function prism(w: number, h: number, d: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  return geo;
}

function columns(g: THREE.Group, positions: [number, number][], h: number, r = 0.11, y = 0) {
  for (const [x, z] of positions) {
    add(g, cyl(r, r * 1.15, h, 10), mat(C.cream), x, y + h / 2, z);
    add(g, box(r * 3, 0.08, r * 3), mat(C.cream2), x, y + h + 0.04, z);
    add(g, box(r * 3, 0.06, r * 3), mat(C.cream2), x, y + 0.03, z);
  }
}

// ---------- powłoki budynków ----------
// Budynek jest pusty w środku: podłoga (`floorSurface`), ściany z grubością, skrzydło drzwi na pivocie
// (`doorLeaf`) i dach (`roof`), który edytor chowa dla aktywnego budynku. Z zewnątrz wygląda jak dawniej.


/** Oznacza wszystko w grupie jako dach — chowany w edytorze, gdy budynek jest aktywny. */
function roofGroup(g: THREE.Group, lift = 0): THREE.Group {
  const r = new THREE.Group();
  r.userData.roof = true;
  r.position.y = lift; // dach jedzie w górę o dodatkowe kondygnacje
  g.add(r);
  return r;
}

/** O ile wyżej niż przy jednej kondygnacji stoi wszystko ponad ścianami. */
function roofLift(ctx: BuildCtx, spec: ShellSpec): number {
  return (Math.max(1, ctx.floors ?? 1) - 1) * spec.inner.h;
}

/** Podłoga wnętrza: cienka płyta z flagą, po której stawia się obiekty. Wierzch 1 cm nad cokołem — wspólna płaszczyzna migotałaby. */
function shellFloor(g: THREE.Group, w: number, d: number, x: number, y: number, z: number, material: THREE.Material) {
  const f = add(g, scaleUv(box(w, 0.04, d), w, d), material, x, y - 0.01, z);
  f.userData.floorSurface = true;
  return f;
}

/** Wycinek pierścienia nad biegiem kręconych schodów (kąty jak w `SpiralSpec`), który strop musi omijać. */
export interface StairSector {
  a0: number;
  a1: number;
  inner: number;
  outer: number;
}

/**
 * Strop okrągłego wnętrza jako jedna bryła: koło o promieniu `r` bez wycinka pierścienia nad schodami
 * i bez prostokątnych otworów (schody z Konstrukcji). Kształt leży w płaszczyźnie XZ, po obrocie o −90° wokół X
 * wytłoczenie rośnie w górę; oś Y kształtu to −Z świata, stąd punkty (sin a, −cos a).
 */
export function discSlabGeometry(r: number, sector: StairSector | null, holes: Rect[], thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const pt = (a: number, rr: number): [number, number] => [Math.sin(a) * rr, -Math.cos(a) * rr];
  if (sector && sector.a1 - sector.a0 > 0.01 && sector.inner > 0.05) {
    // zewnętrzny łuk dłuższą drogą od końca wycinka do jego początku, promień do środka, wewnętrzny łuk pod wycinkiem, promień na zewnątrz
    const span = Math.PI * 2 - (sector.a1 - sector.a0);
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const [x, y] = pt(sector.a1 + (span * i) / n, r);
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const m = 16;
    for (let i = 0; i <= m; i++) {
      const [x, y] = pt(sector.a0 + ((sector.a1 - sector.a0) * i) / m, sector.inner);
      shape.lineTo(x, y);
    }
    shape.closePath();
  } else {
    shape.absarc(0, 0, r, 0, Math.PI * 2, false);
  }
  const inSector = (x: number, z: number) => {
    if (!sector) return false;
    const rr = Math.hypot(x, z);
    if (rr < sector.inner) return false;
    const a = Math.atan2(x, z);
    const rel = ((a - sector.a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return rel <= sector.a1 - sector.a0;
  };
  for (const h of holes) {
    // otwór wystający poza koło albo wchodzący w wycinek nad schodami dałby kształt samoprzecinający się — pomijamy go
    const corners: [number, number][] = [[h.x0, h.z0], [h.x1, h.z0], [h.x0, h.z1], [h.x1, h.z1]];
    if (corners.some(([x, z]) => Math.hypot(x, z) >= r || inSector(x, z))) continue;
    const path = new THREE.Path();
    path.moveTo(h.x0, -h.z0);
    path.lineTo(h.x1, -h.z0);
    path.lineTo(h.x1, -h.z1);
    path.lineTo(h.x0, -h.z1);
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Siatka trójkątów geometrii przesuniętej o `offset` — do kolizji pokoju ładowanego (bryły stropu nie są pudełkami). */
export function trimeshOf(geo: THREE.BufferGeometry, offset: [number, number, number]): Trimesh {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const vertices = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    vertices[i * 3] = pos.getX(i) + offset[0];
    vertices[i * 3 + 1] = pos.getY(i) + offset[1];
    vertices[i * 3 + 2] = pos.getZ(i) + offset[2];
  }
  const indices = geo.index ? new Uint32Array(geo.index.array) : new Uint32Array(Array.from({ length: pos.count }, (_, i) => i));
  return { vertices, indices };
}

export interface SpiralSpec {
  cx: number;
  cz: number;
  /** Promień zewnętrzny i wewnętrzny stopni. */
  r: number;
  inner: number;
  /** Podłoga startowa i wysokość do pokonania. */
  y0: number;
  height: number;
  /** Kąt startu i łączny obrót (radiany, rośnie zgodnie z ruchem wskazówek patrząc z góry). */
  start: number;
  turn: number;
  steps: number;
  /** Prześwit pod stropem (w jednostkach schodów), poniżej którego strop nad biegiem musi mieć otwór. Domyślnie 2,3. */
  headroom?: number;
}

/**
 * Kręcone schody wzdłuż muru: widoczne stopnie bez kolizji i niewidoczne pochylnie (jedyna bryła),
 * jak schody z Konstrukcji. Zwraca wycinek otworu w stropie i wstęgę (do kolizji pokoju, gdy schody
 * nie są częścią modelu obiektu).
 */
export interface Trimesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** Gładka helikalna wstęga na poziomie wierzchów stopni — po niej chodzi postać (bez progów łamanej z pudełek). */
function helixRibbon(spec: SpiralSpec, rise: number): Trimesh {
  const rows = spec.steps * 4;
  const ri = spec.inner - 0.05;
  const ro = spec.r + 0.05;
  const verts: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const a = spec.start + spec.turn * t;
    // wierzch stopnia leży pół stopnia nad linią śrubową; na górze wstęga dochodzi do poziomu stropu
    const y = spec.y0 + Math.min(spec.height, spec.height * t + rise / 2) + 0.02;
    verts.push(spec.cx + Math.sin(a) * ri, y, spec.cz + Math.cos(a) * ri);
    verts.push(spec.cx + Math.sin(a) * ro, y, spec.cz + Math.cos(a) * ro);
    if (j > 0) {
      const b = 2 * j;
      idx.push(b - 2, b - 1, b, b - 1, b + 1, b);
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

/**
 * Kręcone schody wzdłuż muru: widoczne stopnie bez kolizji i niewidoczna helikalna wstęga jako jedyna
 * bryła (w modelu obiektu trafia do siatki kolizji; pokój dostaje ją osobno przez `ribbon`).
 * Zwraca wycinek pierścienia nad częścią schodów, gdzie prześwit pod stropem spada poniżej `headroom`.
 */
export function spiralStairs(g: THREE.Group, spec: SpiralSpec, stepMat: THREE.Material): { sector: StairSector; ribbon: Trimesh } {
  const rise = spec.height / spec.steps;
  const rm = (spec.r + spec.inner) / 2;
  const da = spec.turn / spec.steps;
  const run = rm * da;
  const width = spec.r - spec.inner;
  const holeFrom = Math.max(0.1, 1 - (spec.headroom ?? 2.3) / spec.height);
  for (let i = 0; i < spec.steps; i++) {
    const a = spec.start + da * (i + 0.5);
    const x = spec.cx + Math.sin(a) * rm;
    const z = spec.cz + Math.cos(a) * rm;
    const y = spec.y0 + rise * (i + 0.5);
    // lokalna oś X to styczna (kierunek wznoszenia), lokalna Z to promień
    const step = add(g, box(run + 0.02, rise, width), stepMat, x, y, z, [0, a, 0]);
    step.userData.skipCollider = true;
  }
  // otwór w stropie: wycinek pierścienia nad stopniami, nad którymi prześwit spadłby poniżej `headroom`
  const sector: StairSector = { a0: spec.start + da * Math.floor(spec.steps * holeFrom), a1: spec.start + spec.turn, inner: spec.inner - 0.06, outer: spec.r + 0.06 };
  const ribbon = helixRibbon(spec, rise);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(ribbon.vertices, 3));
  geo.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, stepMat);
  mesh.visible = false;
  g.add(mesh);
  return { sector, ribbon };
}

/** Ściana budynku: `wallNormal` (lokalny kierunek na zewnątrz) pozwala edytorowi chować ściany od strony kamery. */
/**
 * Ściana powłoki jako jedna bryła z otworami (wytłoczony kształt z dziurami) — bez szwów między słupkami
 * a nadprożem i bez współpłaszczyznowych ścianek. Kształt leży w płaszczyźnie (u, v), grubość wzdłuż lokalnego Z.
 */
export function wallGeometry(u0: number, u1: number, v0: number, v1: number, holes: WallHole[], depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(u0, v0);
  shape.lineTo(u1, v0);
  shape.lineTo(u1, v1);
  shape.lineTo(u0, v1);
  shape.closePath();
  for (const h of holes) {
    // otwór nie może dotykać krawędzi ściany — zostaje co najmniej 2 cm muru
    const a0 = Math.max(u0 + 0.02, h.u0);
    const a1 = Math.min(u1 - 0.02, h.u1);
    const b0 = Math.max(v0 + 0.02, h.v0);
    const b1 = Math.min(v1 - 0.02, h.v1);
    if (a1 - a0 < 0.02 || b1 - b0 < 0.02) continue;
    const path = new THREE.Path();
    path.moveTo(a0, b0);
    path.lineTo(a1, b0);
    path.lineTo(a1, b1);
    path.lineTo(a0, b1);
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Ściana wzdłuż X na głębokości `z` (normalna ±Z). `u` = x modelu. */
function shellWallX(g: THREE.Group, x0: number, x1: number, y0: number, y1: number, z: number, m: THREE.Material, normal: [number, number], holes: WallHole[], lining?: THREE.Material) {
  const mesh = add(g, wallGeometry(x0, x1, y0, y1, holes, SHELL_WALL_T), m, 0, 0, z);
  mesh.userData.wallNormal = normal;
  if (lining) shellLining(g, wallGeometry(x0, x1, y0, y1, holes, LINING_T), lining, 0, z - normal[1] * (SHELL_WALL_T / 2 + LINING_T / 2 + LINING_GAP), 0, normal);
  return mesh;
}

const LINING_T = 0.01;
/** Odsunięcie okładziny od lica muru. Dwa milimetry ginęły w precyzji bufora głębi na telefonie. */
const LINING_GAP = 0.006;
/**
 * Okładzina wewnętrzna ściany powłoki (tapeta, boazeria): cienka bryła z tymi samymi otworami tuż przy licu
 * od środka — jedna bryła ściany nie może mieć innej faktury na zewnątrz i wewnątrz. Chowa się razem ze ścianą.
 */
function shellLining(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, z: number, yaw: number, normal: [number, number]) {
  const lining = add(g, geo, m, x, 0, z, [0, yaw, 0]);
  lining.castShadow = false;
  lining.userData.wallNormal = normal;
  lining.userData.skipCollider = true;
  return lining;
}

/** Ściana wzdłuż Z na `x` (normalna ±X). `u` = z modelu (obrót −90° mapuje lokalne x na z świata). */
function shellWallZ(g: THREE.Group, z0: number, z1: number, y0: number, y1: number, x: number, m: THREE.Material, normal: [number, number], holes: WallHole[], lining?: THREE.Material) {
  const mesh = add(g, wallGeometry(z0, z1, y0, y1, holes, SHELL_WALL_T), m, x, 0, 0, [0, -Math.PI / 2, 0]);
  mesh.userData.wallNormal = normal;
  if (lining) shellLining(g, wallGeometry(z0, z1, y0, y1, holes, LINING_T), lining, x - normal[0] * (SHELL_WALL_T / 2 + LINING_T / 2 + LINING_GAP), 0, -Math.PI / 2, normal);
  return mesh;
}

/** Stropy między kondygnacjami budynku: pudełka omijające otwory nad schodami; po nich też stawia się obiekty. */
function shellSlabs(g: THREE.Group, ctx: BuildCtx, base: Rect[], floorY: number, H: number, m: THREE.Material, extraHoles: Rect[][] = []) {
  const floors = Math.max(1, ctx.floors ?? 1);
  // przy piwnicy strop parteru (k = 0) też jest stropem z otworem, a nie litą podłogą
  const from = ctx.basement ? 0 : 1;
  for (let k = from; k < floors; k++) {
    const idx = k - from;
    let rects: Rect[] = base.map((r) => ({ ...r }));
    for (const op of ctx.slabOpenings?.[idx] ?? []) rects = subtractRect(rects, { x0: op.cx - op.hx, x1: op.cx + op.hx, z0: op.cz - op.hz, z1: op.cz + op.hz });
    for (const hole of extraHoles[idx] ?? []) rects = subtractRect(rects, hole);
    for (const r of rects) {
      if (r.x1 - r.x0 < 0.01 || r.z1 - r.z0 < 0.01) continue;
      const slab = add(g, scaleUv(box(r.x1 - r.x0, 0.04, r.z1 - r.z0), r.x1 - r.x0, r.z1 - r.z0, r.x0, r.z0), m, (r.x0 + r.x1) / 2, floorY + k * H - 0.02, (r.z0 + r.z1) / 2);
      slab.userData.floorSurface = true;
      slab.userData.slab = k;
    }
  }
}

/**
 * Niewidoczna pochylnia od ziemi do progu: autostep kontrolera nie pokonuje krawędzi cokołu w siatce
 * trójkątów (tak samo jak przy schodach), a po pochylni gracz wchodzi płynnie. `zOut` > `zDoor`.
 */
function shellRamp(g: THREE.Group, x: number, zOut: number, zDoor: number, width: number, yTop: number) {
  const dz = zOut - zDoor;
  const top = yTop - 0.04;
  const ramp = add(g, box(width, 0.1, Math.hypot(dz, top) + 0.1), mat(C.stone), x, top / 2, (zOut + zDoor) / 2, [Math.atan2(top, dz), 0, 0]);
  ramp.visible = false;
}

/** Skrzydło drzwi budynku na zawiasie przy lewej krawędzi otworu; obraca je SceneManager jak drzwi z Konstrukcji. */
function shellLeaf(g: THREE.Group, door: { x: number; z: number; w: number; h: number }, floorY: number, material: THREE.Material) {
  const pivot = new THREE.Group();
  pivot.position.set(door.x - door.w / 2, floorY, door.z);
  pivot.userData.doorLeaf = true;
  const leaf = add(pivot, box(door.w - 0.02, door.h - 0.02, 0.05), material, door.w / 2, door.h / 2, 0);
  leaf.userData.skipCollider = true;
  g.add(pivot);
}

/** Prostokątna powłoka: podłoga, cztery ściany z drzwiami z przodu, skrzydło, stropy pięter. */
function shellBox(g: THREE.Group, ctx: BuildCtx, type: string, wallMat: THREE.Material, floorMat: THREE.Material, leafMat: THREE.Material) {
  const spec = SHELLS[type];
  const { w, d, h } = spec.inner;
  const x0 = spec.cx - w / 2;
  const x1 = spec.cx + w / 2;
  const z0 = spec.cz - d / 2;
  const z1 = spec.cz + d / 2;
  const y0 = spec.floorY;
  const floors = Math.max(1, ctx.floors ?? 1);
  const y1 = spec.floorY + floors * h;
  // piwnica: mur i wnętrze schodzą o kondygnację poniżej podłogi parteru
  const yBase = ctx.basement ? y0 - h : y0;
  const t = SHELL_WALL_T / 2;
  const f = shellWindows(g, ctx, type);
  const floorFinish = ctx.finish?.floor ? finishMat(ctx.finish.floor, C.stone) : floorMat;
  const lining = ctx.finish?.wall ? finishMat(ctx.finish.wall, C.cream) : undefined;
  // elewacja: faktura mnożona przez kolor muru, żeby paleta materiałów dalej działała
  const outer = ctx.finish?.facade ? finishMat(ctx.finish.facade, C.cream, { tint: true }) : wallMat;
  shellFloor(g, w, d, spec.cx, yBase, spec.cz, floorFinish);
  const doorHole: WallHole[] = spec.door ? [{ u0: spec.door.x - spec.door.w / 2, u1: spec.door.x + spec.door.w / 2, v0: y0 - 0.02, v1: y0 + spec.door.h }] : [];
  shellWallX(g, x0 - t, x1 + t, yBase - 0.01, y1, z0 - t, outer, [0, -1], f.back ?? [], lining); // tylna
  shellWallX(g, x0 - t, x1 + t, yBase - 0.01, y1, z1 + t, outer, [0, 1], [...doorHole, ...(f.front ?? [])], lining); // przednia
  shellWallZ(g, z0, z1, yBase - 0.01, y1, x0 - t, outer, [-1, 0], f.left ?? [], lining);
  shellWallZ(g, z0, z1, yBase - 0.01, y1, x1 + t, outer, [1, 0], f.right ?? [], lining);
  if (spec.door) shellLeaf(g, spec.door, y0, leafMat);
  shellSlabs(g, ctx, [{ x0, x1, z0, z1 }], y0, h, floorFinish);
}

/**
 * Okna wbudowane w mur: otwory ze spisu `SHELL_WINDOWS` (bez tych, na które nachodzi elewacja z biblioteki)
 * dołożone do otworów ścian, a w każdym otworze rama, szczeblina, szyba i parapet. Zwraca otwory per ściana.
 */
function shellWindows(g: THREE.Group, ctx: BuildCtx, type: string): Record<string, WallHole[]> {
  const floors = Math.max(1, ctx.floors ?? 1);
  const user = ctx.facade ?? {};
  const builtin = shellWindowHoles(type, floors, user);
  const walls = new Map(facadeWallsOf(type).map((w) => [w.key, w]));
  const merged: Record<string, WallHole[]> = {};
  for (const key of new Set([...Object.keys(user), ...Object.keys(builtin)])) merged[key] = [...(user[key] ?? []), ...(builtin[key] ?? [])];
  for (const [key, holes] of Object.entries(builtin)) {
    const wall = walls.get(key);
    if (!wall) continue;
    for (const h of holes) shellWindowFrame(g, wall, h);
  }
  return merged;
}

/** Rama okna w otworze muru: cztery listwy, krzyż szczeblin, szyba i parapet zewnętrzny (jednostki modelu). */
function shellWindowFrame(g: THREE.Group, wall: FacadeWall, h: WallHole) {
  const u = (h.u0 + h.u1) / 2;
  const w = h.u1 - h.u0;
  const hh = h.v1 - h.v0;
  const win = new THREE.Group();
  win.position.set(wall.cx + wall.tx * u, (h.v0 + h.v1) / 2, wall.cz + wall.tz * u);
  win.rotation.y = Math.atan2(wall.nx, wall.nz);
  win.userData.wallNormal = [wall.nx, wall.nz]; // chowa się razem ze ścianą od strony kamery
  const frame = woodMat(C.woodDark);
  const t = 0.02;
  const depth = SHELL_WALL_T + 0.02;
  add(win, box(t, hh, depth), frame, -w / 2 + t / 2, 0, 0);
  add(win, box(t, hh, depth), frame, w / 2 - t / 2, 0, 0);
  add(win, box(w, t, depth), frame, 0, hh / 2 - t / 2, 0);
  add(win, box(w, t, depth), frame, 0, -hh / 2 + t / 2, 0);
  add(win, box(0.012, hh - t * 2, 0.03), frame, 0, 0, 0);
  add(win, box(w - t * 2, 0.012, 0.03), frame, 0, 0, 0);
  const glass = add(win, box(w - t * 2, hh - t * 2, 0.008), glassMat(), 0, 0, 0);
  glass.castShadow = false;
  glass.userData.skipCollider = true;
  add(win, box(w + 0.04, 0.02, 0.06), mat(C.stone), 0, -hh / 2 - 0.01, SHELL_WALL_T / 2 + 0.02); // parapet
  for (const c of win.children) c.userData.skipCollider = true;
  g.add(win);
}

/** Pochylnia wejściowa budynku: przed drzwiami, o szerokości otworu z zapasem. */
function shellEntryRamp(g: THREE.Group, spec: ShellSpec, zOut: number) {
  if (!spec.door) return;
  shellRamp(g, spec.door.x, zOut, spec.door.z - 0.1, spec.door.w + 0.4, spec.floorY);
}

/**
 * Cokół pod budynkiem: pełna płyta, a przy piwnicy pierścień wokół wnętrza. Pełna płyta ma wierzch dokładnie
 * na poziomie podłogi parteru, więc zamykałaby klatkę schodową i nie dałoby się zejść na poziom −1.
 */
function basePlate(g: THREE.Group, ctx: BuildCtx, type: string, w: number, d: number, h: number, y: number, cz: number, material: THREE.Material) {
  const outer: Rect = { x0: -w / 2, x1: w / 2, z0: cz - d / 2, z1: cz + d / 2 };
  const spec = SHELLS[type];
  const rects =
    ctx.basement && spec
      ? subtractRect([outer], { x0: spec.cx - spec.inner.w / 2, x1: spec.cx + spec.inner.w / 2, z0: spec.cz - spec.inner.d / 2, z1: spec.cz + spec.inner.d / 2 })
      : [outer];
  for (const r of rects) {
    if (r.x1 - r.x0 < 0.01 || r.z1 - r.z0 < 0.01) continue;
    add(g, box(r.x1 - r.x0, h, r.z1 - r.z0), material, (r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
  }
}

function buildPalace(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.palace;
  const { w, d } = spec.inner;
  const front = spec.cz + d / 2 + SHELL_WALL_T / 2; // lico ściany frontowej
  basePlate(g, ctx, 'palace', w + 1.3, d + 1.5, 0.28, 0.14, spec.cz + 0.1, mat(C.stone));
  basePlate(g, ctx, 'palace', w + 0.7, d + 0.9, 0.16, 0.36, spec.cz + 0.1, mat(C.cream2));
  shellBox(g, ctx, 'palace', mat(C.cream), mat(C.stone), mat(C.dark));
  shellEntryRamp(g, spec, front + 1.3);
  // portyk przed licem ściany: kolumny między drzwiami (|x| < 0,3) a oknami (|x| ∈ 1,92..2,28) i za oknami
  columns(g, [[-2.75, front + 0.19], [-1.1, front + 0.19], [1.1, front + 0.19], [2.75, front + 0.19]], 1.7, 0.11, 0.44);
  add(g, box(w + 0.2, 0.22, 0.6), mat(C.cream2), 0, 0.44 + 1.7 + 0.11, front + 0.07);
  const roof = roofGroup(g, roofLift(ctx, spec));
  add(roof, prism(w + 0.4, 0.7, 0.7), mat(C.cream), 0, 0.44 + 1.92, front + 0.07);
  add(roof, box(w + 0.18, 0.08, d + 0.18), mat(C.cream2), 0, 2.34 + 0.04, spec.cz); // strop nad salą
  // bęben + kopuła
  add(roof, cyl(2.0, 2.0, 0.45, 20), mat(C.cream2), 0, 0.44 + 1.9 + 0.22, spec.cz);
  add(roof, cyl(2.15, 2.15, 0.1, 20), mat(C.stone), 0, 0.44 + 1.9 + 0.5, spec.cz);
  const dome = new THREE.SphereGeometry(2.0, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  add(roof, dome, mat(C.dome, { flat: false }), 0, 0.44 + 1.9 + 0.55, spec.cz);
  add(roof, sphere(0.16, 8), mat(C.domeDark), 0, 0.44 + 1.9 + 0.55 + 2.05, spec.cz);
  // schody
  add(g, box(3.0, 0.12, 0.5), mat(C.stone), 0, 0.06, front + 0.95);
  add(g, box(3.0, 0.12, 0.3), mat(C.stoneDark), 0, 0.18, front + 0.85);
}

function buildLibrary(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.library;
  const { w, d } = spec.inner;
  const front = spec.cz + d / 2 + SHELL_WALL_T / 2;
  basePlate(g, ctx, 'library', w + 0.9, d + 1.1, 0.24, 0.12, spec.cz + 0.1, mat(C.stone));
  shellBox(g, ctx, 'library', mat(C.cream), mat(C.stone), mat(C.dark));
  shellEntryRamp(g, spec, front + 1.3);
  // kolumny przed ścianą, poza drzwiami (|x| < 0,35) i oknami (|x| ∈ 1,83..2,17)
  columns(g, [[-2.7, front + 0.18], [-1.0, front + 0.18], [1.0, front + 0.18], [2.7, front + 0.18]], 1.6, 0.1, 0.24);
  add(g, box(w + 0.2, 0.18, 0.55), mat(C.cream2), 0, 0.24 + 1.6 + 0.09, front + 0.08);
  const roof = roofGroup(g, roofLift(ctx, spec));
  add(roof, box(w + 0.18, 0.1, d + 0.18), mat(C.cream2), 0, 1.94 + 0.05, spec.cz); // strop
  add(roof, prism(w + 0.5, 1.2, d + 0.7), mat(C.roof), 0, 0.24 + 1.78, spec.cz);
  add(g, box(0.9, 0.16, 0.14), mat(C.roofDark), 0, 0.24 + 1.35, front + 0.1);
  add(g, box(2.0, 0.1, 0.6), mat(C.stone), 0, 0.05, front + 0.9);
}

function buildTemple(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.temple;
  const { w, d } = spec.inner;
  add(g, box(w + 0.4, 0.22, d + 0.4), mat(C.stone), 0, 0.11, 0);
  add(g, box(w, 0.14, d), mat(C.cream2), 0, 0.29, 0);
  const templeFloor = finishMat(ctx.finish?.floor, C.cream2);
  shellFloor(g, w, d, 0, spec.floorY, 0, templeFloor);
  shellSlabs(g, ctx, [{ x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 }], spec.floorY, spec.inner.h, templeFloor);
  shellRamp(g, 0, d / 2 + 0.6, d / 2, 2.0, spec.floorY); // wejście między kolumnami od frontu
  const fixed = shellFixedBoxes('temple');
  columns(g, fixed.slice(0, -1).map((b) => [b.cx, b.cz] as [number, number]), 1.5, 0.1, 0.36);
  const roof = roofGroup(g, roofLift(ctx, spec));
  add(roof, box(w, 0.16, d), mat(C.cream), 0, 0.36 + 1.5 + 0.08, 0);
  add(roof, prism(w + 0.2, 1.0, d + 0.2), mat(C.roof), 0, 0.36 + 1.66, 0);
  add(g, box(0.8, 0.9, 0.8), mat(C.cream2), 0, 0.36 + 0.45, fixed[fixed.length - 1].cz); // ołtarz
}

function buildTower(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.tower;
  const r = TOWER_R;
  // przy piwnicy cokół wieży to sama obręcz (walec bez den) — pełny dysk zamykałby zejście
  add(g, ctx.basement ? new THREE.CylinderGeometry(r + 0.2, r + 0.3, 0.3, 12, 1, true) : cyl(r + 0.2, r + 0.3, 0.3, 12), mat(C.stone), 0, 0.15, 0);
  const floorFinish = finishMat(ctx.finish?.floor, C.stone);
  const lining = ctx.finish?.wall ? finishMat(ctx.finish.wall, C.cream) : undefined;
  const outer = finishMat(ctx.finish?.facade, C.cream, { tint: true });
  const yBase = ctx.basement ? spec.floorY - spec.inner.h : spec.floorY;
  const floor = add(g, scaleUv(cyl(r - 0.06, r - 0.06, 0.04, 12), 2 * r, 2 * r), floorFinish, 0, yBase - 0.01, 0);
  floor.userData.floorSurface = true;
  // mur z dwunastu segmentów o wysokości wszystkich kondygnacji; przedni ma otwór drzwi
  const side = 2 * r * Math.tan(Math.PI / 12);
  const h = spec.inner.h;
  const floors = Math.max(1, ctx.floors ?? 1);
  const top = spec.floorY + floors * h;
  const door = spec.door!;
  const f = shellWindows(g, ctx, 'tower');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const holes: WallHole[] = [...(f[`seg${i}`] ?? [])];
    if (i === 0) holes.push({ u0: -door.w / 2, u1: door.w / 2, v0: spec.floorY - 0.02, v1: spec.floorY + door.h });
    const seg = add(g, wallGeometry(-side / 2 - 0.01, side / 2 + 0.01, yBase - 0.01, top, holes, 0.1), outer, x, 0, z, [0, a, 0]);
    seg.userData.wallNormal = [Math.sin(a), Math.cos(a)];
    if (lining) shellLining(g, wallGeometry(-side / 2 - 0.01, side / 2 + 0.01, yBase - 0.01, top, holes, LINING_T), lining, Math.sin(a) * (r - 0.05 - LINING_T / 2 - 0.002), Math.cos(a) * (r - 0.05 - LINING_T / 2 - 0.002), a, [Math.sin(a), Math.cos(a)]);
  }
  shellLeaf(g, door, spec.floorY, mat(C.dark));
  shellEntryRamp(g, spec, r + 0.7);
  // wieża ma wbudowane kręcone schody wzdłuż muru: jeden ciągły bieg przez wszystkie kondygnacje (każda
  // następny bieg zaczyna się tam, gdzie poprzedni doszedł do stropu. Pierścień biegu zostawia pośrodku każdej
  // izby wolne koło o promieniu ~3,5 m przy skali 2,5.
  const sy = ctx.scaleY ?? spec.minScale;
  // kąt biegu z nachylenia ~30°: przy szerokim murze pełne 3/4 obrotu dałoby pochylnię, przy wąskim byłoby za stromo
  const rm = (r - 0.08 + (r - 0.58)) / 2;
  const turn = Math.min(Math.PI * 1.5, Math.max(Math.PI / 2, h / (Math.tan(Math.PI / 6) * rm)));
  const steps = Math.max(8, Math.round((turn * rm * sy) / 0.3)); // stopień ~0,3 m w metrach świata
  // przy piwnicy pierwszy bieg zaczyna się poziom niżej i strop parteru też dostaje wycięcie nad nim
  const fromK = ctx.basement ? 0 : 1;
  for (let k = fromK; k < floors; k++) {
    const { sector } = spiralStairs(g, { cx: 0, cz: 0, r: r - 0.08, inner: r - 0.58, y0: spec.floorY + (k - 1) * h, height: h, start: Math.PI / 2 + (k - 1) * turn, turn, steps, headroom: 2.2 / sy }, mat(C.stoneDark));
    const holes = (ctx.slabOpenings?.[k - fromK] ?? []).map((op) => ({ x0: op.cx - op.hx, x1: op.cx + op.hx, z0: op.cz - op.hz, z1: op.cz + op.hz }));
    const slab = add(g, discSlabGeometry(r - 0.05, sector, holes, 0.04), floorFinish, 0, spec.floorY + k * h - 0.04, 0);
    slab.userData.floorSurface = true;
    slab.userData.slab = k;
  }
  const lift = top - 3.9; // gzyms i stożek siedzą na szczycie muru
  const coneH = 1.2 + r * 0.6;
  const roof = roofGroup(g, lift);
  add(roof, cyl(r + 0.1, r + 0.1, 0.22, 12), mat(C.cream2), 0, 3.9 + 0.11, 0);
  add(roof, cone(r + 0.18, coneH, 12), mat(C.roof), 0, 4.12 + coneH / 2, 0);
  add(roof, sphere(0.12), mat(C.domeDark), 0, 4.12 + coneH, 0);
}

function buildHouse(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.house;
  const { w, d } = spec.inner;
  basePlate(g, ctx, 'house', w + 0.5, d + 0.5, 0.16, 0.08, 0, mat(C.stone));
  shellBox(g, ctx, 'house', mat(C.cream), woodMat(C.wood), mat(C.dark));
  shellEntryRamp(g, spec, d / 2 + 0.8);
  const roof = roofGroup(g, roofLift(ctx, spec));
  add(roof, prism(w + 0.4, 1.2, d + 0.4), mat(C.roof), 0, 1.56, 0);
  add(roof, box(0.36, 0.9, 0.36), mat(C.stoneDark), w * 0.3, 2.1, -d * 0.25);
}

function buildGazebo(g: THREE.Group) {
  add(g, cyl(1.5, 1.6, 0.2, 6), mat(C.stone), 0, 0.1, 0);
  add(g, cyl(1.3, 1.3, 0.1, 6), mat(C.cream2), 0, 0.25, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    add(g, cyl(0.07, 0.07, 1.8, 8), woodMat(C.wood), Math.cos(a) * 1.15, 0.3 + 0.9, Math.sin(a) * 1.15);
  }
  add(g, cyl(1.45, 1.45, 0.12, 6), woodMat(C.woodDark), 0, 2.16, 0);
  add(g, cone(1.6, 0.9, 6), mat(C.roof), 0, 2.22 + 0.45, 0);
  add(g, box(0.7, 0.45, 0.7), woodMat(C.wood), 0, 0.3 + 0.22, 0);
}

function buildFountain(g: THREE.Group) {
  add(g, cyl(1.2, 1.3, 0.35, 16), mat(C.stone), 0, 0.17, 0);
  add(g, cyl(1.05, 1.05, 0.2, 16), mat(C.water, { flat: false, roughness: 0.3 }), 0, 0.32, 0);
  add(g, cyl(0.12, 0.16, 0.9, 10), mat(C.stoneDark), 0, 0.35 + 0.45, 0);
  add(g, cyl(0.55, 0.35, 0.22, 14), mat(C.stone), 0, 1.25, 0);
  add(g, cyl(0.45, 0.45, 0.08, 14), mat(C.water, { flat: false, roughness: 0.3 }), 0, 1.36, 0);
  add(g, cyl(0.06, 0.06, 0.5, 8), mat(C.stoneDark), 0, 1.6, 0);
  add(g, sphere(0.14, 8), mat(C.water, { flat: false, roughness: 0.3 }), 0, 1.9, 0);
}

function buildBench(g: THREE.Group) {
  add(g, box(1.4, 0.08, 0.45), woodMat(C.wood), 0, 0.45, 0);
  add(g, box(1.4, 0.4, 0.07), woodMat(C.wood), 0, 0.72, -0.2, [-0.15, 0, 0]);
  for (const x of [-0.6, 0.6]) {
    add(g, box(0.08, 0.45, 0.4), mat(C.metal), x, 0.22, 0);
    add(g, box(0.08, 0.5, 0.06), mat(C.metal), x, 0.7, -0.19, [-0.15, 0, 0]);
  }
}

function buildLantern(g: THREE.Group) {
  add(g, cyl(0.16, 0.2, 0.12, 8), mat(C.metal), 0, 0.06, 0);
  add(g, cyl(0.05, 0.07, 2.0, 8), mat(C.metal), 0, 1.06, 0);
  add(g, box(0.34, 0.42, 0.34), mat(C.glow, { emissive: '#f4d27a' }), 0, 2.25, 0);
  add(g, box(0.4, 0.06, 0.4), mat(C.metal), 0, 2.03, 0);
  add(g, cone(0.32, 0.22, 4), mat(C.metal), 0, 2.57, 0, [0, Math.PI / 4, 0]);
  const light = new THREE.PointLight('#ffd98a', 0.6, 5, 2);
  light.position.set(0, 2.25, 0);
  g.add(light);
}

/** Glify runiczne (na wzór futharku) jako łamane w kwadracie 0..1, y w dół — rysowane kreską, bez zależności od czcionek. */
const RUNES: [number, number][][][] = [
  [[[0.2, 0], [0.2, 1]], [[0.2, 0.5], [0.8, 0.25]], [[0.2, 0.25], [0.8, 0]]],
  [[[0.15, 1], [0.15, 0], [0.85, 0.3], [0.85, 1]]],
  [[[0.2, 0], [0.2, 1]], [[0.2, 0.25], [0.8, 0.5], [0.2, 0.75]]],
  [[[0.2, 0], [0.2, 1]], [[0.2, 0.1], [0.8, 0.35]], [[0.2, 0.4], [0.8, 0.65]]],
  [[[0.2, 1], [0.2, 0], [0.8, 0.25], [0.2, 0.5], [0.8, 1]]],
  [[[0.8, 0], [0.2, 0.5], [0.8, 1]]],
  [[[0.1, 0.1], [0.9, 0.9]], [[0.9, 0.1], [0.1, 0.9]]],
  [[[0.2, 1], [0.2, 0], [0.8, 0.25], [0.2, 0.5]]],
  [[[0.2, 0], [0.2, 1]], [[0.8, 0], [0.8, 1]], [[0.2, 0.35], [0.8, 0.65]]],
  [[[0.5, 0], [0.5, 1]], [[0.2, 0.35], [0.8, 0.65]]],
  [[[0.5, 0], [0.5, 1]]],
  [[[0.5, 0], [0.5, 1]], [[0.15, 0.05], [0.5, 0.4], [0.85, 0.05]]],
  [[[0.7, 0], [0.3, 0.4], [0.7, 0.6], [0.3, 1]]],
  [[[0.5, 0], [0.5, 1]], [[0.15, 0.3], [0.5, 0], [0.85, 0.3]]],
  [[[0.2, 1], [0.2, 0], [0.75, 0.25], [0.2, 0.5], [0.75, 0.75], [0.2, 1]]],
  [[[0.15, 1], [0.15, 0], [0.5, 0.35], [0.85, 0], [0.85, 1]]],
  [[[0.15, 1], [0.15, 0], [0.85, 0.55]], [[0.85, 1], [0.85, 0], [0.15, 0.55]]],
  [[[0.2, 1], [0.2, 0], [0.8, 0.35]]],
  [[[0.5, 0.15], [0.85, 0.5], [0.5, 0.85], [0.15, 0.5], [0.5, 0.15]]],
  [[[0.15, 0], [0.15, 1], [0.85, 0], [0.85, 1], [0.15, 0]]],
  [[[0.5, 0], [0.8, 0.35], [0.5, 0.7], [0.2, 0.35], [0.5, 0]], [[0.35, 0.55], [0.15, 1]], [[0.65, 0.55], [0.85, 1]]],
];

/** Liczba różnych grzbietów — każdy to inny ciąg run i ornament, tekstury współdzielone między książkami. */
const SPINE_VARIANTS = 24;
const spineMats = new Map<number, THREE.MeshStandardMaterial>();
function spineMat(i: number): THREE.MeshStandardMaterial {
  let m = spineMats.get(i);
  if (m) return m;
  const S = 1.5;
  const c = document.createElement('canvas');
  c.width = 64 * S;
  c.height = 256 * S;
  const ctx = c.getContext('2d')!;
  ctx.scale(S, S);
  ctx.strokeStyle = '#e2c27a';
  ctx.fillStyle = '#e2c27a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r = rng(i * 7919 + 13);
  r();
  r(); // rozgrzewka — pierwsze wartości sąsiednich ziaren są skorelowane
  // podwójne linie u góry i u dołu
  for (const y of [22, 30, 226, 234]) {
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(56, y);
    ctx.stroke();
  }
  // ornament u dołu: rozetka, romb albo trzy kreski
  const orn = Math.floor(r() * 3);
  if (orn === 0) {
    ctx.beginPath();
    ctx.arc(32, 200, 9, 0, Math.PI * 2);
    ctx.stroke();
  } else if (orn === 1) {
    ctx.beginPath();
    ctx.moveTo(32, 188);
    ctx.lineTo(43, 200);
    ctx.lineTo(32, 212);
    ctx.lineTo(21, 200);
    ctx.closePath();
    ctx.stroke();
  } else {
    for (const y of [193, 200, 207]) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(44, y);
      ctx.stroke();
    }
  }
  if (orn < 2) {
    ctx.beginPath();
    ctx.arc(32, 200, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // ciąg 3–5 run wzdłuż grzbietu (czyta się od dołu do góry, jak tytuł na obróconym grzbiecie)
  const n = 3 + Math.floor(r() * 3);
  const pitch = 24;
  const gw = 16;
  const gh = 30;
  ctx.save();
  ctx.translate(32, 108);
  ctx.rotate(-Math.PI / 2);
  const x0 = -((n - 1) * pitch + gw) / 2;
  for (let k = 0; k < n; k++) {
    const glyph = RUNES[Math.floor(r() * RUNES.length)];
    const gx = x0 + k * pitch;
    for (const line of glyph) {
      ctx.beginPath();
      line.forEach(([px, py], j) => {
        const lx = gx + px * gw;
        const ly = (py - 0.5) * gh;
        if (j === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, metalness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  spineMats.set(i, m);
  return m;
}

/**
 * Książka: okładka, kartki wystające z przodu i z góry, złocone paski na grzbiecie i tytuł.
 * Grubość wzdłuż X, wysokość Y, grzbiet na +Z. Zwraca grupę do ustawienia przez wywołującego.
 */
function book(g: THREE.Group, w: number, h: number, d: number, cover: THREE.Material, title: number): THREE.Group {
  const b = new THREE.Group();
  add(b, box(w, h, d), cover, 0, 0, 0);
  // blok kartek: cieńszy od okładki, wysunięty w stronę otwarcia (−Z) i widoczny od góry
  add(b, box(w - 0.012, h - 0.02, d - 0.01), mat(C.paper, { roughness: 1 }), 0, 0, -0.012);
  const gold = mat(C.gold, { roughness: 0.35, metalness: 0.7 });
  for (const y of [h * 0.36, -h * 0.36]) add(b, box(w + 0.004, 0.008, 0.004), gold, 0, y, d / 2);
  const spine = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.92), spineMat(title));
  spine.position.set(0, 0, d / 2 + 0.003);
  spine.userData.skipCollider = true;
  b.add(spine);
  g.add(b);
  return b;
}

/** Ciąg deterministycznych liczb 0..1 z ziarna — regały różnią się układem, ale nie zmieniają go przy przebudowie. */
function rng(seed: number) {
  let x = (seed * 9301 + 49297) % 233280 || 1;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

const BOOK_COLORS: (() => string)[] = [() => C.book1, () => C.book2, () => C.book3, () => C.velvet, () => C.cypress, () => C.fabric, () => C.woodDark, () => C.leafDark];

/** Stos książek: cztery leżące tomy z grzbietami w różne strony i otwarta książka na wierzchu. */
function buildBooks(g: THREE.Group, ctx: BuildCtx) {
  const r = rng((ctx.variant ?? 0) + 7);
  let y = 0;
  const sizes: [number, number, number][] = [[0.07, 0.34, 0.24], [0.06, 0.3, 0.22], [0.05, 0.32, 0.23], [0.06, 0.28, 0.2]];
  sizes.forEach(([w, h, d], i) => {
    const b = book(g, w, h, d, mat(BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]()), Math.floor(r() * SPINE_VARIANTS));
    b.rotation.set(0, (r() - 0.5) * 0.6 + (i % 2 ? Math.PI : 0), Math.PI / 2);
    b.position.set((r() - 0.5) * 0.04, y + w / 2, (r() - 0.5) * 0.04);
    y += w;
  });
  // otwarta książka: dwie strony pod lekkim kątem
  const open = new THREE.Group();
  open.position.set(0, y + 0.01, 0);
  open.rotation.y = (r() - 0.5) * 0.8;
  for (const sgn of [-1, 1]) {
    add(open, box(0.14, 0.012, 0.2), mat(C.paper, { roughness: 1 }), sgn * 0.075, 0.012, 0, [0, 0, sgn * 0.12]);
    add(open, box(0.15, 0.006, 0.21), mat(C.woodDark), sgn * 0.075, 0.003, 0, [0, 0, sgn * 0.12]);
  }
  g.add(open);
}

function buildStatue(g: THREE.Group) {
  add(g, box(0.9, 0.2, 0.9), mat(C.stone), 0, 0.1, 0);
  add(g, box(0.6, 0.8, 0.6), mat(C.cream2), 0, 0.6, 0);
  add(g, cyl(0.22, 0.28, 0.9, 10), mat(C.stoneDark), 0, 1.45, 0);
  add(g, sphere(0.2, 10), mat(C.stoneDark), 0, 2.05, 0);
  add(g, box(0.62, 0.12, 0.2), mat(C.stoneDark), 0, 1.7, 0, [0, 0, 0.1]);
}

function buildObelisk(g: THREE.Group) {
  add(g, box(1.0, 0.16, 1.0), mat(C.stone), 0, 0.08, 0);
  add(g, box(0.6, 0.3, 0.6), mat(C.cream2), 0, 0.31, 0);
  add(g, cyl(0.16, 0.26, 2.6, 4), mat(C.stoneDark), 0, 0.46 + 1.3, 0, [0, Math.PI / 4, 0]);
  add(g, cone(0.17, 0.35, 4), mat(C.domeDark), 0, 3.06 + 0.17, 0, [0, Math.PI / 4, 0]);
}

function buildChest(g: THREE.Group) {
  add(g, box(0.9, 0.5, 0.6), woodMat(C.wood), 0, 0.25, 0);
  const lid = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10, 1, false, 0, Math.PI);
  add(g, lid, woodMat(C.woodDark), 0, 0.5, 0, [0, 0, Math.PI / 2]);
  add(g, box(0.92, 0.06, 0.62), mat(C.metal), 0, 0.5, 0);
  add(g, box(0.12, 0.16, 0.06), mat(C.metal), 0, 0.42, 0.31);
}

function buildSignpost(g: THREE.Group) {
  add(g, cyl(0.05, 0.06, 2.0, 8), woodMat(C.woodDark), 0, 1.0, 0);
  add(g, box(0.9, 0.22, 0.06), woodMat(C.wood), 0.3, 1.7, 0, [0, 0.4, 0]);
  add(g, box(0.8, 0.22, 0.06), woodMat(C.wood), -0.25, 1.4, 0, [0, -0.6, 0]);
  add(g, box(0.16, 0.16, 0.16), mat(C.stone), 0, 0.08, 0);
}

function buildWell(g: THREE.Group) {
  add(g, cyl(0.7, 0.75, 0.7, 12), mat(C.stoneDark), 0, 0.35, 0);
  add(g, cyl(0.5, 0.5, 0.05, 12), mat(C.water, { flat: false, roughness: 0.3 }), 0, 0.7, 0);
  for (const x of [-0.6, 0.6]) add(g, box(0.1, 1.5, 0.1), woodMat(C.wood), x, 0.75 + 0.7, 0);
  add(g, prism(1.7, 0.5, 1.2), mat(C.roof), 0, 2.15, 0);
  add(g, cyl(0.04, 0.04, 1.3, 6), woodMat(C.woodDark), 0, 1.75, 0, [0, 0, Math.PI / 2]);
  add(g, cyl(0.16, 0.16, 0.24, 8), woodMat(C.woodDark), 0, 1.75, 0, [0, 0, Math.PI / 2]);
}

/**
 * Mały samolot z otwartym kokpitem: nos w stronę −Z (jak kierunek marszu przy obrocie obiektu),
 * koła stoją na wysokości 0. Sekcja kokpitu to wanna z podłogą i burtami — dzięki temu pilot
 * widzi wnętrze od środka, a nie prześwit przez jednostronne ścianki kadłuba.
 */
function buildPlane(g: THREE.Group) {
  const body = mat(C.cream2);
  const accent = mat(C.roof);
  const metal = mat(C.metal);
  const dark = mat(C.dark);

  // kadłub: owiewka silnika, sekcja przednia, stożek ogonowy (cylinder obrócony o 90° ma promień górny od +Z)
  add(g, cyl(0.46, 0.42, 0.85, 10), accent, 0, 1.0, -1.98, [Math.PI / 2, 0, 0]);
  add(g, cyl(0.44, 0.45, 0.85, 10), body, 0, 1.0, -1.13, [Math.PI / 2, 0, 0]);
  add(g, cyl(0.12, 0.44, 1.85, 10), body, 0, 1.0, 1.78, [Math.PI / 2, 0, 0]);

  // wanna kokpitu
  add(g, box(0.86, 0.1, 1.5), woodMat(C.woodDark), 0, 0.66, 0.06);
  for (const x of [-0.42, 0.42]) add(g, box(0.09, 0.8, 1.5), body, x, 1.05, 0.06);
  add(g, box(0.86, 0.62, 0.09), body, 0, 0.96, -0.72);
  add(g, box(0.86, 0.8, 0.09), body, 0, 1.05, 0.84);
  // wyściółka burt: od środka kabina jest drewniana jak tablica i podłoga
  for (const x of [-0.36, 0.36]) add(g, box(0.02, 0.78, 1.5), woodMat(C.wood), x, 1.05, 0.06);
  // burta obłożona skórą — rama otwartego kokpitu
  for (const x of [-0.45, 0.45]) add(g, box(0.1, 0.06, 1.56), dark, x, 1.45, 0.06);
  add(g, box(1.0, 0.06, 0.1), dark, 0, 1.45, -0.76);
  add(g, box(1.0, 0.06, 0.1), dark, 0, 1.45, 0.87);

  // fotel i zagłówek
  add(g, box(0.5, 0.09, 0.44), mat(C.velvet), 0, 0.76, 0.28);
  add(g, box(0.5, 0.6, 0.09), mat(C.velvet), 0, 1.09, 0.53);
  add(g, box(0.34, 0.22, 0.1), dark, 0, 1.5, 0.6);

  // tablica przyrządów z zegarami (tarcza + wskazówka pod różnym kątem)
  add(g, box(0.8, 0.34, 0.07), woodMat(C.woodDark), 0, 1.18, -0.64);
  const dials: [number, number][] = [[-0.24, -0.9], [0, 2.1], [0.24, 0.7]];
  for (const [x, a] of dials) {
    add(g, cyl(0.085, 0.085, 0.03, 12), metal, x, 1.19, -0.6, [Math.PI / 2, 0, 0]);
    add(g, cyl(0.07, 0.07, 0.02, 12), mat(C.linen), x, 1.19, -0.585, [Math.PI / 2, 0, 0]);
    add(g, box(0.012, 0.056, 0.012), dark, x + Math.sin(a) * 0.027, 1.19 + Math.cos(a) * 0.027, -0.575, [0, 0, -a]);
  }
  for (const x of [-0.1, 0.1]) add(g, cyl(0.02, 0.02, 0.05, 6), mat(C.gold), x, 1.04, -0.59, [Math.PI / 2, 0, 0]);
  // wiatrochron: niska szyba, nad którą widać maskę silnika i śmigło
  add(g, box(0.78, 0.05, 0.07), dark, 0, 1.35, -0.71);
  add(g, box(0.72, 0.28, 0.03), glassMat(), 0, 1.5, -0.73, [-0.3, 0, 0]);

  // drążek i pedały
  add(g, cyl(0.028, 0.036, 0.44, 8), metal, 0, 0.95, -0.06, [-0.12, 0, 0]);
  add(g, sphere(0.055, 8), dark, 0, 1.18, -0.09);
  for (const x of [-0.14, 0.14]) add(g, box(0.16, 0.05, 0.2), metal, x, 0.76, -0.48, [-0.35, 0, 0]);

  // skrzydło dolne z lekkim wzniosem, przed kabiną — inaczej zasłaniałoby widok w dół
  add(g, box(0.9, 0.16, 1.3), body, 0, 0.58, -1.0);
  for (const s of [-1, 1]) {
    add(g, box(2.55, 0.13, 1.2), body, s * 1.725, 0.67, -1.0, [0, 0, s * 0.06]);
    add(g, box(0.1, 0.16, 1.0), accent, s * 2.98, 0.75, -1.0, [0, 0, s * 0.06]);
  }

  // usterzenie
  add(g, box(2.3, 0.1, 0.62), body, 0, 1.05, 2.4);
  add(g, prism(0.85, 0.8, 0.09), accent, 0, 1.1, 2.42, [0, Math.PI / 2, 0]);

  // podwozie
  for (const s of [-1, 1]) {
    add(g, box(0.1, 0.44, 0.13), metal, s * 1.0, 0.42, -1.1);
    add(g, cyl(0.3, 0.3, 0.16, 12), dark, s * 1.0, 0.3, -1.1, [0, 0, Math.PI / 2]);
    add(g, cyl(0.1, 0.1, 0.18, 8), metal, s * 1.0, 0.3, -1.1, [0, 0, Math.PI / 2]);
  }
  add(g, box(0.07, 0.58, 0.07), metal, 0, 0.57, 2.55);
  add(g, cyl(0.14, 0.14, 0.09, 8), dark, 0, 0.14, 2.55, [0, 0, Math.PI / 2]);

  // śmigło: osobna grupa, którą scena obraca w locie
  const prop = new THREE.Group();
  prop.position.set(0, 1.0, -2.42);
  prop.userData.rig = 'propeller';
  g.add(prop);
  add(prop, cone(0.2, 0.42, 10), accent, 0, 0, -0.16, [-Math.PI / 2, 0, 0]);
  add(prop, box(0.16, 1.75, 0.04), woodMat(C.wood), 0, 0, 0);
  add(prop, cyl(0.09, 0.09, 0.1, 8), metal, 0, 0, 0, [Math.PI / 2, 0, 0]);
}

// ---------- wierzchowce z plików GLB (Poly Pizza, CC0) ----------

/**
 * Wierzchowce z plików: jak dopasować model do sceny. `height` to docelowa wysokość w metrach,
 * `yaw` obraca model tak, żeby patrzył w −Z (jak samolot), `clips` to nazwy klipów na postój, marsz i bieg.
 */
export interface AssetMount {
  file: string;
  height: number;
  yaw: number;
  clips: { idle: string; walk?: string; run: string; jump?: string };
}

export const ASSET_MOUNTS: Record<string, AssetMount> = {
  horse: { file: 'horse.glb', height: 1.9, yaw: Math.PI, clips: { idle: 'Idle', walk: 'Walk', run: 'Gallop', jump: 'Gallop_Jump' } },
};

/**
 * Model z pliku: klon wczytanego GLB przeskalowany do `height`, ze stopami na ziemi i przodem w −Z. Zanim plik
 * dojedzie, zostaje sama bryła zastępcza — scena przebuduje wpis po wczytaniu. Niewidzialne pudło daje bryłę
 * kolizji i wysokość, bo skórowana siatka nie ma sensownej ramki bez szkieletu.
 */
function buildAssetMount(type: string): (g: THREE.Group) => void {
  return (g) => {
    const spec = ASSET_MOUNTS[type];
    const asset = assetLoaded(spec.file);
    const proxy = new THREE.Mesh(box(1, 1, 1), mat(C.metal));
    proxy.visible = false;
    proxy.userData.noPick = true;
    g.add(proxy);
    if (!asset) {
      proxy.scale.set(1.2, spec.height, 2.4);
      proxy.position.y = spec.height / 2;
      g.userData.asset = 0;
      return;
    }
    const b = asset.bounds;
    const size = b.getSize(new THREE.Vector3());
    const k = spec.height / size.y;
    const model = cloneAsset(asset);
    model.scale.setScalar(k);
    const center = b.getCenter(new THREE.Vector3());
    // środek ramki na osi obiektu, spód na ziemi; obrót do −Z po przesunięciu, więc środek zostaje na osi
    const pivot = new THREE.Group();
    pivot.rotation.y = spec.yaw;
    model.position.set(-center.x * k, -b.min.y * k, -center.z * k);
    pivot.add(model);
    g.add(pivot);
    const rot = Math.abs(Math.sin(spec.yaw)) > 0.5;
    proxy.scale.set((rot ? size.z : size.x) * k, size.y * k, (rot ? size.x : size.z) * k);
    proxy.position.y = (size.y * k) / 2;
    g.userData.asset = 1;
    g.userData.assetModel = model;
  };
}

// ---------- wierzchowce (przód −Z, jak samolot; ruchome części mają `userData.rig`) ----------

/** Pivot ruchomej części: scena znajduje go po nazwie i rusza nim w jeździe, a po niej przywraca tę pozę. */
function rigPivot(parent: THREE.Object3D, name: string, x: number, y: number, z: number): THREE.Group {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  p.userData.rig = name;
  parent.add(p);
  return p;
}

/**
 * Smok wierzchowy: to samo ciało co dziki smok z `wildlife.ts`, półtora raza większe i osiodłane. Materiały ciała nie są
 * w cache `mat()` — trafiają do `userData.ownMaterials`, żeby `disposeObject` je zwolnił.
 */
function buildDragonMount(g: THREE.Group) {
  const p = buildAnimalBody('dragon');
  p.group.scale.setScalar(1.5);
  p.group.position.y = 1.62; // pazury sięgają −1,08 w ciele smoka, więc po powiększeniu stają na ziemi
  g.add(p.group);
  g.userData.ownMaterials = p.ownMaterials ?? [];
  for (const w of p.wings) {
    w.userData.rig = w.position.x < 0 ? 'wingL' : 'wingR';
    w.rotation.z = w.position.x < 0 ? -1.1 : 1.1; // na postoju skrzydła złożone nad grzbietem
  }
  const legNames = ['legFL', 'legFR', 'legBL', 'legBR'];
  p.legs.forEach((l, i) => (l.userData.rig = legNames[i] ?? `leg${i}`));
  if (p.tail) p.tail.userData.rig = 'tail';

  // siodło między nasadami skrzydeł, popręg wokół tułowia, uchwyt dla jeźdźca
  const leather = mat('#5b3a22', { roughness: 0.6 });
  const blanket = mat('#7a1f2e', { roughness: 0.95 });
  add(g, box(1.1, 0.08, 1.2), blanket, 0, 2.3, 0.3);
  add(g, box(0.64, 0.16, 0.9), leather, 0, 2.4, 0.3);
  add(g, box(0.56, 0.22, 0.12), leather, 0, 2.54, -0.12);
  add(g, box(0.6, 0.26, 0.12), leather, 0, 2.56, 0.72);
  add(g, box(1.5, 0.08, 0.14), leather, 0, 1.5, 0.3);
  for (const s of [-1, 1]) add(g, box(0.06, 0.9, 0.14), leather, s * 0.72, 1.92, 0.3);
  add(g, cyl(0.03, 0.03, 0.46, 6), mat(C.metal), 0, 2.68, -0.16, [0, 0, Math.PI / 2]);
}

/**
 * Czerw pustynny: głowa w pivocie (w spoczynku uniesiona, w jeździe wyprostowana), trójdzielna paszcza
 * z zębami, dziesięć segmentów ciała, które w spoczynku łukiem znikają w ziemi, a w jeździe ciągną się
 * śladem głowy. Początek układu leży na gruncie pod środkiem głowy; promień głowy 1,4 m.
 */
function buildSandworm(g: THREE.Group) {
  const R = 1.4;
  const skin = mat('#b8562e', { roughness: 0.95 });
  const ridge = mat('#8f3d22', { roughness: 0.95 });
  const maw = mat('#4a1410', { roughness: 0.9 });
  const teeth = mat('#e9dcc4', { roughness: 0.5 });
  const leather = mat('#5b3a22', { roughness: 0.6 });

  // głowa: walec wzdłuż Z zwężony do przodu, prążki jako cieńsze pierścienie
  const head = rigPivot(g, 'head', 0, R, 0);
  head.rotation.x = 0.9; // spoczynek: nos w górę, jak czerw wyłaniający się z piasku
  add(head, cyl(R * 0.82, R, 4, 14), skin, 0, 0, -1.2, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) add(head, cyl(R * (0.86 + i * 0.024), R * (0.86 + i * 0.024), 0.14, 14), ridge, 0, 0, -2.9 + i * 0.62, [Math.PI / 2, 0, 0]);
  // gardziel i trzy płaty paszczy rozłożone co 120°; każdy otwiera się obrotem wokół własnej osi X
  add(head, cyl(R * 0.7, R * 0.3, 1.6, 12), maw, 0, 0, -3.5, [Math.PI / 2, 0, 0]);
  const petals: [string, number][] = [
    ['jawT', 0],
    ['jawL', (2 * Math.PI) / 3],
    ['jawR', (4 * Math.PI) / 3],
  ];
  for (const [name, a] of petals) {
    const wrap = new THREE.Group();
    wrap.rotation.z = a;
    wrap.position.z = -3.15;
    head.add(wrap);
    const jaw = rigPivot(wrap, name, 0, R * 0.8, 0);
    jaw.rotation.x = 0.35; // lekko rozchylone
    add(jaw, box(1.4, 0.24, 1.7), skin, 0, 0.05, -0.85);
    add(jaw, box(1.1, 0.1, 1.5), maw, 0, -0.1, -0.85);
    for (let t = 0; t < 4; t++) for (const s of [-0.35, 0.35]) add(jaw, cone(0.07, 0.3, 4), teeth, s + (t % 2) * 0.12, -0.25, -0.3 - t * 0.38, [Math.PI, 0, 0]);
  }
  // siodło z uchwytami na grzbiecie głowy
  add(head, box(0.9, 0.1, 1.2), leather, 0, R * 0.98, -0.5);
  add(head, box(0.5, 0.16, 0.8), leather, 0, R * 1.05, -0.5);
  add(head, cyl(0.03, 0.03, 0.6, 6), mat(C.metal), 0, R * 1.05 + 0.3, -0.95, [0, 0, Math.PI / 2]);

  // segmenty: coraz cieńsze walce z prążkami; szerszy koniec (+Z pivotu) patrzy w stronę głowy.
  // Spoczynek: łuk za głową schodzący w ziemię — od trzeciego segmentu ciało jest pod powierzchnią
  const segLen = 3;
  let prev = new THREE.Vector3(0, R, 0.4);
  for (let i = 0; i < 10; i++) {
    const r = R - i * 0.05;
    const center = new THREE.Vector3(0, R - i * 0.9 - i * i * 0.05, 2.2 + i * segLen);
    const seg = rigPivot(g, `seg${i}`, center.x, center.y, center.z);
    seg.userData.radius = r;
    add(seg, cyl(r, r - 0.05, segLen, 14), skin, 0, 0, 0, [Math.PI / 2, 0, 0]);
    for (let k = -1; k <= 1; k++) add(seg, cyl(r + 0.03, r + 0.03, 0.14, 14), ridge, 0, 0, k * 0.95, [Math.PI / 2, 0, 0]);
    seg.lookAt(prev);
    prev = center;
  }
}

function buildTree(g: THREE.Group) {
  add(g, cyl(0.12, 0.18, 1.2, 8), woodMat(C.woodDark), 0, 0.6, 0);
  add(g, dodeca(0.85, 0), mat(C.leaf), 0, 1.75, 0);
  add(g, dodeca(0.6, 0), mat(C.leaf2), 0.45, 2.1, 0.2);
  add(g, dodeca(0.55, 0), mat(C.leafDark), -0.45, 1.5, -0.25);
  add(g, dodeca(0.5, 0), mat(C.leaf), 0.1, 2.35, -0.4);
}

function buildCypress(g: THREE.Group) {
  add(g, cyl(0.08, 0.12, 0.5, 8), woodMat(C.woodDark), 0, 0.25, 0);
  add(g, cone(0.5, 1.6, 8), mat(C.cypress), 0, 0.4 + 0.8, 0);
  add(g, cone(0.4, 1.5, 8), mat(C.cypress2), 0, 1.4 + 0.75, 0);
  add(g, cone(0.26, 1.2, 8), mat(C.cypress), 0, 2.3 + 0.6, 0);
}

function buildBush(g: THREE.Group) {
  const m = add(g, dodeca(0.55, 0), mat(C.leaf2), 0, 0.4, 0);
  m.scale.set(1.2, 0.8, 1.1);
  const m2 = add(g, dodeca(0.4, 0), mat(C.leaf), 0.4, 0.35, 0.2);
  m2.scale.set(1.1, 0.8, 1);
}

function buildFlowers(g: THREE.Group) {
  add(g, box(1.4, 0.18, 0.9), mat(C.soil), 0, 0.09, 0);
  add(g, box(1.5, 0.1, 1.0), mat(C.stone), 0, 0.05, 0);
  const cols = [C.flower1, C.flower2, C.flower3];
  for (let i = 0; i < 10; i++) {
    const x = -0.55 + (i % 5) * 0.28;
    const z = i < 5 ? -0.2 : 0.2;
    add(g, cyl(0.02, 0.02, 0.3, 4), mat(C.leafDark), x, 0.3, z);
    add(g, sphere(0.09, 7), mat(cols[i % 3]), x, 0.48, z);
  }
}

function buildPalm(g: THREE.Group) {
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    add(g, cyl(0.1 - i * 0.008, 0.13 - i * 0.008, 0.6, 7), woodMat(C.woodDark), i * 0.08, 0.3 + i * 0.55, 0, [0, 0, -0.12]);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = add(g, box(1.3, 0.05, 0.3), mat(C.leaf2), 0.4 + Math.cos(a) * 0.55, 3.05, Math.sin(a) * 0.55, [0, -a, -0.35]);
    leaf.scale.set(1, 1, 1);
  }
  add(g, sphere(0.14, 6), mat(C.book3), 0.45, 2.9, 0.1);
}


// ---------- punkty pojawiania zwierząt ----------

/** Marker w edytorze: słupek z dyskiem i pomniejszona sylwetka zwierzęcia. */
function buildSpawnMarker(kind: AnimalKind): (g: THREE.Group) => void {
  return (g) => {
    add(g, cyl(0.45, 0.5, 0.05, 20), mat('#c4703f'), 0, 0.025, 0);
    add(g, cyl(0.05, 0.06, 1.0, 8), mat('#c4703f'), 0, 0.5, 0);
    const body = buildAnimalBody(kind).group;
    body.scale.setScalar(kind === 'dragon' ? 0.22 : 0.7);
    body.position.y = 1.05;
    g.add(body);
  };
}

// ---------- specjalne ----------

/** Brama wejściowa: od niej zaczyna się spacer po pałacu. Przód bramy to +Z. */
function buildGate(g: THREE.Group) {
  for (const x of [-1.5, 1.5]) {
    add(g, box(0.5, 0.3, 0.5), mat(C.stoneDark), x, 0.15, 0);
    add(g, box(0.38, 2.9, 0.38), mat(C.stone), x, 1.7, 0);
    add(g, box(0.5, 0.16, 0.5), mat(C.cream2), x, 3.22, 0);
    add(g, sphere(0.16, 8), mat(C.domeDark), x, 3.42, 0);
  }
  add(g, box(3.6, 0.36, 0.42), mat(C.cream), 0, 3.1, 0);
  add(g, prism(3.8, 0.5, 0.5), mat(C.roof), 0, 3.28, 0);
  // uchylone skrzydła
  for (const s2 of [-1, 1]) {
    const wing = add(g, box(1.25, 2.3, 0.08), woodMat(C.woodDark), s2 * 1.28, 1.2, 0.1);
    wing.rotation.y = s2 * 0.55;
    wing.position.x = s2 * 0.95;
    wing.position.z = 0.35 * 1;
    for (let i = 0; i < 3; i++) {
      const bar = add(g, box(1.1, 0.09, 0.11), woodMat(C.wood), 0, 0.5 + i * 0.8, 0);
      bar.position.copy(wing.position);
      bar.rotation.y = wing.rotation.y;
      bar.translateY(-0.7 + i * 0.75);
      bar.translateZ(0.04);
    }
  }
  add(g, box(3.4, 0.08, 1.2), mat(C.stone), 0, 0.04, 0.9);
}

// ---------- oświetlenie ----------

function buildTorch(g: THREE.Group) {
  add(g, cyl(0.04, 0.05, 1.5, 6), woodMat(C.woodDark), 0, 0.75, 0);
  add(g, cyl(0.09, 0.07, 0.24, 8), mat(C.metal), 0, 1.6, 0);
  add(g, cone(0.1, 0.34, 6), mat('#ff8a3d', { emissive: '#ff5a1a' }), 0, 1.88, 0);
  add(g, cone(0.05, 0.2, 5), mat('#ffd36b', { emissive: '#ffc44d' }), 0, 1.98, 0);
  const light = new THREE.PointLight('#ffb06a', 4, 7, 2);
  light.position.set(0, 1.9, 0);
  g.add(light);
}

function buildLampion(g: THREE.Group) {
  add(g, cyl(0.12, 0.16, 0.1, 8), mat(C.stoneDark), 0, 0.05, 0);
  add(g, cyl(0.035, 0.045, 1.4, 6), mat(C.metal), 0, 0.75, 0);
  add(g, sphere(0.28, 10), mat('#ffe9c2', { emissive: '#ffd58a', flat: false }), 0, 1.65, 0);
  add(g, cyl(0.08, 0.1, 0.06, 8), mat(C.metal), 0, 1.95, 0);
  const light = new THREE.PointLight('#ffd9a0', 3, 6, 2);
  light.position.set(0, 1.65, 0);
  g.add(light);
}

function buildCampfire(g: THREE.Group) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add(g, dodeca(0.16, 0), mat(C.rock), Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55, [0.3, a, 0.2]);
  }
  add(g, cyl(0.06, 0.07, 0.9, 5), woodMat(C.woodDark), 0, 0.14, 0, [0, 0.4, 1.2]);
  add(g, cyl(0.06, 0.07, 0.9, 5), woodMat(C.woodDark), 0, 0.14, 0, [0, 2.5, 1.2]);
  add(g, cyl(0.06, 0.07, 0.9, 5), woodMat(C.woodDark), 0, 0.14, 0, [0, 4.6, 1.2]);
  add(g, cone(0.22, 0.6, 6), mat('#ff7a2e', { emissive: '#ff4d12' }), 0, 0.45, 0);
  add(g, cone(0.12, 0.42, 5), mat('#ffd36b', { emissive: '#ffc44d' }), 0.05, 0.6, 0.03);
  const light = new THREE.PointLight('#ff9a4a', 6, 8, 2);
  light.position.set(0, 0.8, 0);
  g.add(light);
}

// ---------- konstrukcja (wnętrza budynków) ----------

/** Kontekst budowy modelu: wysokość kondygnacji i (dla ścianki) skala X oraz położenia otworów na drzwi. */
export interface BuildCtx {
  floorHeight: number;
  /** Skala X obiektu — ścianka buduje się w jednostkach lokalnych, więc wymiary w metrach dzieli przez nią. */
  scaleX?: number;
  /** Skala Z (szerokość ścieżki) — zaokrąglone końce ścieżki muszą zostać kołami mimo skali. */
  scaleZ?: number;
  /** Środki otworów drzwiowych wzdłuż ścianki, w metrach świata od jej środka. */
  openings?: number[];
  /** Budynek z wnętrzem w miejscu: liczba kondygnacji i otwory w stropach (lokalne jednostki modelu). */
  floors?: number;
  slabOpenings?: Opening[][];
  /** Kondygnacja pod ziemią (poziom −1): mur schodzi niżej, a strop parteru dostaje otwór nad schodami. */
  basement?: boolean;
  /** Skala Y budynku — schody wbudowane liczą wysokość stopnia i prześwit w metrach świata. */
  scaleY?: number;
  /** Otwory elewacji (okna, balkony, tarasy) na ścianach powłoki: klucz ściany → otwory w jej układzie (u wzdłuż, v wysokość). */
  facade?: Record<string, WallHole[]>;
  /** Taras: wysokość podłogi parteru nad ziemią (schodki w dół), metry świata. */
  drop?: number;
  /** Obraz: styl płótna (z hasza id obiektu). */
  variant?: number;
  /** Nadpisane kolory warstw (rola → `#rrggbb`). */
  colors?: Record<string, string>;
  /** Wykończenie: tekstura podłogi, ścian wnętrza i elewacji budynku w miejscu; dla ścieżki `floor` to nawierzchnia. */
  finish?: { floor?: string; wall?: string; facade?: string };
  /** Model z pliku jest już wczytany — zmiana z 0 na 1 przebudowuje wpis, gdy plik dojedzie. */
  asset?: number;
}

export type { WallHole };

/**
 * Ścianka działowa: pełne pudełko albo słupki i nadproża wokół otworów na drzwi.
 * Wysokość o 0,02 m większa od kondygnacji: spód chowa się w podłodze, wierzch w stropie,
 * bo wspólna płaszczyzna z nimi migotałaby.
 */
function buildWall(g: THREE.Group, ctx: BuildCtx) {
  const H = ctx.floorHeight;
  const sx = Math.max(ctx.scaleX ?? 1, 0.01);
  const m = mat(C.cream2);
  const openings = (ctx.openings ?? []).slice().sort((a, b) => a - b);
  const wallH = H + 0.02;
  if (openings.length === 0) {
    add(g, box(WALL_SEGMENT, wallH, WALL_THICKNESS), m, 0, H / 2, 0);
    return;
  }
  // otwory w jednostkach lokalnych (świat / skala X); pełna długość lokalna to zawsze WALL_SEGMENT
  const half = WALL_SEGMENT / 2;
  const ow = DOOR_OPENING.w / sx;
  let cursor = -half;
  const post = (x0: number, x1: number) => {
    if (x1 - x0 < 1e-3) return;
    add(g, box(x1 - x0, wallH, WALL_THICKNESS), m, (x0 + x1) / 2, H / 2, 0);
  };
  for (const t of openings) {
    const c = t / sx;
    const x0 = Math.max(cursor, c - ow / 2);
    const x1 = Math.min(half, c + ow / 2);
    post(cursor, x0);
    // nadproże wchodzi 0,02 m w słupki (bez szczeliny na styku) i jest odrobinę cieńsze,
    // żeby jego lico w słupku leżało za licem słupka, a nie w tej samej płaszczyźnie
    const lintelH = H + 0.01 - DOOR_OPENING.h;
    const inset = 0.02 / sx;
    add(g, box(x1 - x0 + inset * 2, lintelH, WALL_THICKNESS - 0.006), m, (x0 + x1) / 2, DOOR_OPENING.h + lintelH / 2, 0);
    cursor = x1;
  }
  post(cursor, half);
}

/** Szerokość bazowa ścieżki (skala Z ją mnoży) i kafel jej nawierzchni w metrach. */
const PATH_WIDTH = 1.2;
const PATH_TILE = 1.5;

/**
 * Ścieżka: płaski pas o długości `WALL_SEGMENT` (skala X wydłuża) z półokrągłymi końcami, żeby kolejne odcinki
 * łączyły się bez szczelin na zakrętach. Nawierzchnia z `finish.floor` (domyślnie żwir).
 */
function buildPath(g: THREE.Group, ctx: BuildCtx) {
  const sx = Math.max(ctx.scaleX ?? 1, 0.01);
  const sz = Math.max(ctx.scaleZ ?? 1, 0.01);
  const m = finishMat(ctx.finish?.floor ?? 'gravel', C.stoneDark, { roughness: 1 });
  const h = 0.03;
  const strip = add(g, scaleUv(box(WALL_SEGMENT, h, PATH_WIDTH), (WALL_SEGMENT * sx) / PATH_TILE, (PATH_WIDTH * sz) / PATH_TILE), m, 0, h / 2, 0);
  strip.castShadow = false;
  for (const x of [-WALL_SEGMENT / 2, WALL_SEGMENT / 2]) {
    const cap = add(g, scaleUv(cyl(PATH_WIDTH / 2, PATH_WIDTH / 2, h, 16), (PATH_WIDTH * sz) / PATH_TILE, (PATH_WIDTH * sz) / PATH_TILE), m, x, h / 2, 0);
    cap.castShadow = false;
    cap.scale.x = sz / sx; // koło w świecie mimo różnej skali X i Z obiektu
    cap.userData.pathCap = true;
  }
}

/**
 * Drzwi bez własnego muru: ościeżnica wpuszczona 0,02 m w otwór ścianki, próg, skrzydło płycinowe
 * z klamką. Lokalny środek leży w osi ścianki; oś X biegnie wzdłuż ścianki.
 */
function buildDoor(g: THREE.Group) {
  const lightW = DOOR_OPENING.w - 0.16; // światło 1,0 m
  const lightH = DOOR_OPENING.h - 0.08; // 2,1 m
  const jambW = 0.1; // 0,08 widoczne + 0,02 w murze
  const depth = WALL_THICKNESS + 0.04;
  const frame = woodMat(C.woodDark);
  const jambX = lightW / 2 + jambW / 2;
  add(g, box(jambW, lightH + 0.1, depth), frame, -jambX, (lightH + 0.1) / 2, 0);
  add(g, box(jambW, lightH + 0.1, depth), frame, jambX, (lightH + 0.1) / 2, 0);
  add(g, box(lightW + jambW * 2, jambW, depth), frame, 0, lightH + jambW / 2, 0);
  // próg: spód w podłodze
  add(g, box(lightW, 0.03, depth), mat(C.stoneDark), 0, 0.005, 0);

  // skrzydło na zawiasie przy lewym boku; obraca je SceneManager (`toggleDoor`)
  const pivot = new THREE.Group();
  pivot.position.set(-lightW / 2, 0, 0);
  pivot.userData.doorLeaf = true;
  // szczelina 1,5 cm wokół skrzydła — większa prześwitywała jasnym pasem przy ościeżnicy
  const leafW = lightW - 0.03;
  const leafH = lightH - 0.03;
  const leafT = 0.05;
  const leafX = 0.015 + leafW / 2;
  const leafY = 0.01 + leafH / 2;
  const leafMat = woodMat(C.wood);
  const panelMat = mat('#c9a074');
  const parts: THREE.Mesh[] = [];
  parts.push(add(pivot, box(leafW, leafH, leafT), leafMat, leafX, leafY, 0));
  // płyciny: obwódka lekko nad licem, wypełnienie cofnięte — po obu stronach skrzydła
  const panelW = leafW - 0.24;
  const panels: [number, number][] = [
    [leafY + leafH * 0.22, leafH * 0.36],
    [leafY - leafH * 0.24, leafH * 0.32],
  ];
  for (const side of [-1, 1]) {
    for (const [py, ph] of panels) {
      parts.push(add(pivot, box(panelW, ph, 0.012), woodMat(C.woodDark), leafX, py, side * (leafT / 2 + 0.003)));
      parts.push(add(pivot, box(panelW - 0.08, ph - 0.08, 0.02), panelMat, leafX, py, side * (leafT / 2 - 0.004)));
    }
    // klamka: pręt poziomy i gałka przy krawędzi zamka
    const hx = leafX + leafW / 2 - 0.1;
    parts.push(add(pivot, cyl(0.016, 0.016, 0.05, 8), mat(C.metal), hx, 1.02, side * (leafT / 2 + 0.02), [Math.PI / 2, 0, 0]));
    parts.push(add(pivot, box(0.12, 0.024, 0.024), mat(C.metal), hx - 0.045, 1.02, side * (leafT / 2 + 0.05)));
  }
  for (const part of parts) part.userData.skipCollider = true;
  g.add(pivot);
}

/** Lampa sufitowa: obiekt stoi na podłodze piętra, a klosz i światło wiszą pod jego sufitem. */
function buildCeilingLamp(g: THREE.Group, ctx: BuildCtx) {
  const H = ctx.floorHeight;
  add(g, cyl(0.012, 0.012, 0.4, 6), mat(C.metal), 0, H - 0.22, 0);
  add(g, cyl(0.3, 0.22, 0.18, 10), mat('#ffe7a3', { emissive: '#f6d68a' }), 0, H - 0.5, 0);
  const light = new THREE.PointLight('#ffe2b0', 14, 14, 2);
  light.position.set(0, H - 0.6, 0);
  g.add(light);
}

function buildStairs(g: THREE.Group, ctx: BuildCtx) {
  const H = ctx.floorHeight;
  const len = 1.15 * H;
  const width = 1.2;
  const rise = 0.2;
  const steps = Math.max(1, Math.round(H / rise));
  const run = len / steps;
  for (let i = 0; i < steps; i++) {
    const y = rise * (i + 1) - rise / 2;
    // najniższy stopień przy -Z lokalnie: bez obrotu wejście jest od strony +Z (jak drzwi budynków)
    const z = -len / 2 + run * (i + 0.5);
    const step = add(g, box(width, rise, run + 0.02), mat(C.stone), 0, y, z);
    step.userData.skipCollider = true;
  }
  const slope = -Math.atan2(H, len);
  // spód biegu: bez niego z dołu (piwnica, otwarta klatka) widać osobno wiszące stopnie zamiast schodów
  const soffit = add(g, box(width, 0.22, Math.hypot(len, H) - 0.25), mat(C.stoneDark), 0, H / 2 + rise / 2 - 0.055 - 0.185, 0, [slope, 0, 0]);
  soffit.userData.skipCollider = true;
  // niewidoczna pochylnia: jedyna bryła kolizji, płynniejsza niż schodkowanie stopni; jej wierzch
  // przechodzi przez wierzchy stopni, żeby postać nie płynęła przez ich krawędzie
  const rampLen = Math.hypot(len, H);
  const ramp = add(g, box(width + 0.1, 0.15, rampLen), mat(C.stone), 0, H / 2 + rise / 2 + 0.02 - 0.075, 0, [slope, 0, 0]);
  ramp.visible = false;
}

// ---------- elewacja (obiekt stoi na licu muru, lokalne +Z to na zewnątrz) ----------

/** Balustrada: słupki co 0,3 m i poręcz, wzdłuż odcinka od (x0,z0) do (x1,z1) na wysokości `y`. */
function railing(g: THREE.Group, x0: number, z0: number, x1: number, z1: number, y: number, m: THREE.Material) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.round(len / 0.3) + 1);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    add(g, cyl(0.02, 0.02, 1.0, 6), m, x0 + (x1 - x0) * t, y + 0.5, z0 + (z1 - z0) * t);
  }
  add(g, box(0.05, 0.05, len + 0.05), m, (x0 + x1) / 2, y + 1.0, (z0 + z1) / 2, [0, yaw, 0]);
  add(g, box(0.03, 0.03, len + 0.05), m, (x0 + x1) / 2, y + 0.5, (z0 + z1) / 2, [0, yaw, 0]);
}

/** Okno w murze: rama wpuszczona w otwór, słupek, przezroczysta tafla i parapet. */
function buildWindow(g: THREE.Group) {
  const { w, h, sill } = FACADE.window;
  const frame = woodMat(C.woodDark);
  const depth = 0.24;
  const zc = -depth / 2 + 0.02;
  add(g, box(0.08, h, depth), frame, -w / 2 + 0.04, sill + h / 2, zc);
  add(g, box(0.08, h, depth), frame, w / 2 - 0.04, sill + h / 2, zc);
  add(g, box(w, 0.08, depth), frame, 0, sill + 0.04, zc);
  add(g, box(w, 0.08, depth), frame, 0, sill + h - 0.04, zc);
  add(g, box(0.04, h - 0.16, 0.05), frame, 0, sill + h / 2, zc);
  add(g, box(w - 0.16, 0.04, 0.05), frame, 0, sill + h / 2, zc);
  const glass = add(g, box(w - 0.16, h - 0.16, 0.02), glassMat(), 0, sill + h / 2, zc);
  glass.castShadow = false;
  add(g, box(w + 0.16, 0.06, 0.16), mat(C.stone), 0, sill - 0.03, 0.08); // parapet zewnętrzny
}

/** Balkon na piętrze: płyta na wspornikach, balustrada z trzech stron, próg w otworze. */
function buildBalcony(g: THREE.Group) {
  const { w } = FACADE.balcony;
  const pw = 1.6;
  const pd = 1.0;
  const stone = mat(C.stone);
  add(g, box(pw, 0.12, pd), stone, 0, -0.06, pd / 2);
  add(g, box(w, 0.03, 0.3), stone, 0, 0.015, -0.14); // próg w grubości muru
  for (const x of [-pw / 2 + 0.2, pw / 2 - 0.2]) add(g, box(0.12, 0.3, 0.6), mat(C.stoneDark), x, -0.27, 0.3, [Math.PI / 4, 0, 0]);
  const rail = mat(C.metal);
  railing(g, -pw / 2, pd, pw / 2, pd, 0, rail);
  railing(g, -pw / 2, 0.05, -pw / 2, pd, 0, rail);
  railing(g, pw / 2, 0.05, pw / 2, pd, 0, rail);
  // ościeżnica wyjścia
  const frame = woodMat(C.woodDark);
  add(g, box(0.08, 2.1, 0.2), frame, -w / 2 - 0.04, 1.05, -0.08);
  add(g, box(0.08, 2.1, 0.2), frame, w / 2 + 0.04, 1.05, -0.08);
  add(g, box(w + 0.16, 0.08, 0.2), frame, 0, 2.1 + 0.04, -0.08);
}

/** Taras przy parterze: szeroka płyta z balustradą i schodkami na ziemię (`ctx.drop` = wysokość podłogi nad ziemią). */
function buildTerrace(g: THREE.Group, ctx: BuildCtx) {
  const { w } = FACADE.terrace;
  const pw = 2.4;
  const pd = 1.6;
  const stone = mat(C.stone);
  add(g, box(pw, 0.12, pd), stone, 0, -0.06, pd / 2);
  add(g, box(w, 0.03, 0.3), stone, 0, 0.015, -0.14);
  const rail = mat(C.metal);
  railing(g, -pw / 2, 0.05, -pw / 2, pd, 0, rail);
  railing(g, pw / 2, 0.05, pw / 2, pd, 0, rail);
  // balustrada frontowa z przerwą na schodki pośrodku
  railing(g, -pw / 2, pd, -0.6, pd, 0, rail);
  railing(g, 0.6, pd, pw / 2, pd, 0, rail);
  const drop = Math.max(0.1, ctx.drop ?? 0.3);
  const steps = Math.max(1, Math.ceil(drop / 0.18));
  const rise = drop / steps;
  const run = 0.3;
  for (let i = 0; i < steps; i++) {
    const step = add(g, box(1.1, rise, run + 0.02), stone, 0, -rise * (i + 0.5), pd + run * (i + 0.5));
    step.userData.skipCollider = true;
  }
  const len = steps * run;
  const ramp = add(g, box(1.2, 0.1, Math.hypot(len, drop) + 0.1), stone, 0, -drop / 2 + 0.02, pd + len / 2, [Math.atan2(drop, len), 0, 0]);
  ramp.visible = false;
  const frame = woodMat(C.woodDark);
  add(g, box(0.08, 2.1, 0.2), frame, -w / 2 - 0.04, 1.05, -0.08);
  add(g, box(0.08, 2.1, 0.2), frame, w / 2 + 0.04, 1.05, -0.08);
  add(g, box(w + 0.16, 0.08, 0.2), frame, 0, 2.1 + 0.04, -0.08);
}

// ---------- wyposażenie wnętrz ----------

function buildTable(g: THREE.Group) {
  add(g, box(1.6, 0.1, 0.9), woodMat(C.wood), 0, 0.76, 0);
  add(g, box(1.5, 0.06, 0.8), woodMat(C.woodDark), 0, 0.7, 0);
  for (const [x, z] of [[-0.68, -0.34], [0.68, -0.34], [-0.68, 0.34], [0.68, 0.34]] as [number, number][]) {
    add(g, box(0.1, 0.72, 0.1), woodMat(C.woodDark), x, 0.36, z);
  }
  add(g, box(0.4, 0.04, 0.3), mat(C.paper), 0.3, 0.83, 0.1, [0, 0.3, 0]);
}

/**
 * Regał: boki, gzyms, cokół i tylna ścianka z ciemniejszego drewna, cztery półki z listwą czołową, a na nich
 * książki stojące, pochylone i leżące w stosach — układ z ziarna obiektu.
 */
function buildShelf(g: THREE.Group, ctx: BuildCtx) {
  const dark = woodMat(C.woodDark);
  const light = woodMat(C.wood);
  const W = 1.4;
  const D = 0.38;
  const H = 2.2;
  // plecy i cokół lekko cofnięte/wysunięte względem boków, żeby tylne ścianki nie leżały w jednej płaszczyźnie
  add(g, box(W - 0.1, H, 0.03), dark, 0, H / 2, -D / 2 + 0.02); // plecy
  for (const x of [-W / 2 + 0.025, W / 2 - 0.025]) add(g, box(0.05, H, D), dark, x, H / 2, 0);
  add(g, box(W + 0.08, 0.06, D + 0.06), dark, 0, H + 0.03, 0.02); // gzyms
  add(g, box(W + 0.02, 0.03, D + 0.02), light, 0, H - 0.015, 0.02);
  add(g, box(W + 0.04, 0.12, D + 0.02), dark, 0, 0.06, 0.02); // cokół
  const r = rng((ctx.variant ?? 0) + 3);
  const innerW = W - 0.1;
  const limit = innerW / 2 - 0.01; // prawa granica dla książek (przed boczną ścianką)
  for (let shelf = 0; shelf < 4; shelf++) {
    const y = 0.28 + shelf * 0.5;
    add(g, box(innerW, 0.04, D - 0.04), light, 0, y, 0);
    // listwa czołowa wysunięta przed deskę półki — ich przednie ścianki nie mogą leżeć w jednej płaszczyźnie (migotanie)
    add(g, box(innerW, 0.05, 0.02), dark, 0, y, D / 2 - 0.02);
    // od lewej: grupy stojących książek, czasem pochylona, czasem stos leżących, czasem przerwa
    let x = -innerW / 2 + 0.04;
    const top = y + 0.02;
    while (x < limit - 0.05) {
      const kind = r();
      if (kind < 0.12) {
        x += 0.06 + r() * 0.1; // przerwa
        continue;
      }
      if (kind < 0.3 && x + 0.32 < limit) {
        // stos 2–3 leżących tomów, grzbietami do przodu (najdłuższy tom ma 0,30 m — musi się zmieścić przed ścianką)
        const n = 2 + Math.floor(r() * 2);
        let sy = top;
        let maxH = 0;
        for (let i = 0; i < n; i++) {
          const w = 0.035 + r() * 0.03;
          const h = 0.22 + r() * 0.08;
          const b = book(g, w, h, 0.2 + r() * 0.06, mat(BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]()), Math.floor(r() * SPINE_VARIANTS));
          b.rotation.set(0, 0, Math.PI / 2);
          b.position.set(x + h / 2, sy + w / 2, 0.02);
          sy += w;
          maxH = Math.max(maxH, h);
        }
        x += maxH + 0.03;
        continue;
      }
      // grupa stojących; każdy tom musi zmieścić się przed ścianką (pochylony potrzebuje zapasu na wychylony wierzch)
      const n = 2 + Math.floor(r() * 5);
      let placed = 0;
      for (let i = 0; i < n; i++) {
        const w = 0.035 + r() * 0.035;
        const h = 0.24 + r() * 0.16;
        const d = 0.18 + r() * 0.08;
        const lean = i === n - 1 && r() < 0.35 ? -0.18 : 0;
        if (x + w + (lean ? h * 0.2 : 0) > limit) break;
        const b = book(g, w, h, d, mat(BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]()), Math.floor(r() * SPINE_VARIANTS));
        b.rotation.z = lean;
        b.position.set(x + w / 2 + (lean ? h * 0.08 : 0), top + h / 2, 0.03 - r() * 0.02);
        x += w + 0.004 + (lean ? 0.05 : 0);
        placed++;
      }
      if (!placed) break;
      x += r() < 0.4 ? 0.02 : 0;
    }
  }
}

let globeTex: THREE.CanvasTexture | null = null;
/** Mapa globusa: ocean i kontynenty z szumu — jedna tekstura na sesję. */
function globeTexture(): THREE.CanvasTexture {
  if (globeTex) return globeTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7fa7c2';
  ctx.fillRect(0, 0, 256, 128);
  const img = ctx.getImageData(0, 0, 256, 128);
  const n = new Noise2D(77);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 256; x++) {
      // szum na sferze: x zawija się, więc mieszamy dwa odczyty na krawędzi
      const v = n.fbm(x * 0.03, y * 0.03, 4) * 0.5 + n.fbm((256 - x) * 0.03 + 9, y * 0.03, 4) * 0.5;
      const polar = Math.abs(y - 64) > 56;
      if (v > 0.08 || polar) {
        const i = (y * 256 + x) * 4;
        const [r, g, b] = polar ? [240, 242, 240] : v > 0.2 ? [150, 140, 100] : [140, 165, 105];
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(60,50,40,0.25)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 32, 0);
    ctx.lineTo(i * 32, 128);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * 32);
    ctx.lineTo(256, i * 32);
    ctx.stroke();
  }
  globeTex = new THREE.CanvasTexture(c);
  globeTex.colorSpace = THREE.SRGBColorSpace;
  return globeTex;
}

/** Globus: toczona podstawa, mosiężny południk i kula z mapą, pochylona jak Ziemia. */
function buildGlobe(g: THREE.Group) {
  const brass = mat(C.gold, { roughness: 0.35, metalness: 0.7 });
  add(g, cyl(0.16, 0.2, 0.03, 16), woodMat(C.woodDark), 0, 0.015, 0);
  add(g, cyl(0.04, 0.06, 0.16, 10), woodMat(C.woodDark), 0, 0.11, 0);
  add(g, cyl(0.02, 0.03, 0.3, 8), brass, 0, 0.34, 0);
  const tilt = new THREE.Group();
  tilt.position.set(0, 0.7, 0);
  tilt.rotation.z = 0.41;
  add(tilt, new THREE.TorusGeometry(0.27, 0.012, 8, 32), brass, 0, 0, 0, [0, Math.PI / 2, 0]);
  add(tilt, cyl(0.008, 0.008, 0.58, 6), brass, 0, 0, 0);
  const globe = add(tilt, new THREE.SphereGeometry(0.24, 24, 16), mat('#ffffff', { roughness: 0.6, flat: false, map: globeTexture() }), 0, 0, 0);
  globe.castShadow = true;
  g.add(tilt);
}

/** Naczynia na drewnianej tacy: talerze, dwa kubki, dzbanek i misa — z niebieskim paskiem. */
function buildDishes(g: THREE.Group) {
  const white = mat(C.linen, { roughness: 0.5, flat: false });
  const band = mat(C.book2, { roughness: 0.5, flat: false });
  add(g, box(0.9, 0.025, 0.55), woodMat(C.wood), 0, 0.012, 0);
  for (const x of [-0.45, 0.45]) add(g, box(0.02, 0.06, 0.55), woodMat(C.woodDark), x, 0.04, 0);
  // talerze: stos dwóch i jeden osobno
  for (const [x, z, n] of [[-0.25, 0.12, 2], [0.08, 0.16, 1]] as [number, number, number][]) {
    for (let i = 0; i < n; i++) {
      add(g, cyl(0.13, 0.09, 0.015, 20), white, x, 0.032 + i * 0.016, z);
      add(g, new THREE.TorusGeometry(0.11, 0.004, 6, 24), band, x, 0.041 + i * 0.016, z, [Math.PI / 2, 0, 0]);
    }
  }
  // kubki z uszkiem
  for (const [x, z, a] of [[0.3, 0.15, 0.4], [0.32, -0.08, 2.2]] as [number, number, number][]) {
    add(g, cyl(0.045, 0.04, 0.09, 14), white, x, 0.07, z);
    add(g, cyl(0.046, 0.046, 0.012, 14), band, x, 0.1, z);
    add(g, new THREE.TorusGeometry(0.025, 0.007, 6, 14), white, x + Math.cos(a) * 0.055, 0.07, z + Math.sin(a) * 0.055, [0, -a, 0]);
  }
  // dzbanek
  add(g, cyl(0.06, 0.08, 0.2, 14), white, -0.28, 0.125, -0.15);
  add(g, cyl(0.07, 0.06, 0.03, 14), white, -0.28, 0.24, -0.15);
  add(g, cyl(0.065, 0.065, 0.02, 14), band, -0.28, 0.16, -0.15);
  add(g, new THREE.TorusGeometry(0.05, 0.01, 6, 14), white, -0.2, 0.15, -0.15, [0, 0, 0]);
  add(g, box(0.05, 0.02, 0.03), white, -0.34, 0.245, -0.15, [0, 0, 0.3]); // dzióbek
  // misa
  add(g, cyl(0.13, 0.07, 0.08, 18), white, 0.05, 0.065, -0.15);
  add(g, cyl(0.12, 0.12, 0.012, 18), band, 0.05, 0.1, -0.15);
  add(g, cyl(0.115, 0.115, 0.01, 18), mat(C.flower2), 0.05, 0.1, -0.15); // owoce w środku
}

/** Słoik ze świetlikami — znacznik roju (cząstki dokłada scena). */
function buildFireflyJar(g: THREE.Group) {
  add(g, cyl(0.1, 0.1, 0.24, 14), glassMat(), 0, 0.13, 0);
  add(g, cyl(0.07, 0.07, 0.02, 14), mat(C.gold, { roughness: 0.4, metalness: 0.6 }), 0, 0.26, 0);
  add(g, cyl(0.075, 0.075, 0.03, 14), woodMat(C.woodDark), 0, 0.28, 0);
  add(g, cyl(0.035, 0.035, 0.12, 8), mat(C.glow, { emissive: '#d8e86a' }), 0, 0.13, 0);
  const light = new THREE.PointLight('#d8ff7a', 2.5, 4, 2);
  light.position.set(0, 0.5, 0);
  g.add(light);
}

/** Ul na podstawce — znacznik roju pszczół. */
function buildBeehive(g: THREE.Group) {
  add(g, box(0.5, 0.06, 0.5), woodMat(C.woodDark), 0, 0.03, 0);
  for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as [number, number][]) add(g, box(0.05, 0.3, 0.05), woodMat(C.woodDark), x, 0.21, z);
  add(g, box(0.44, 0.04, 0.44), woodMat(C.wood), 0, 0.38, 0);
  add(g, box(0.4, 0.5, 0.4), woodMat(C.wood), 0, 0.65, 0);
  for (const y of [0.52, 0.66, 0.8]) add(g, box(0.41, 0.015, 0.41), woodMat(C.woodDark), 0, y, 0);
  add(g, box(0.12, 0.03, 0.02), mat(C.dark), 0, 0.43, 0.2); // wylot
  add(g, box(0.16, 0.02, 0.06), woodMat(C.woodDark), 0, 0.41, 0.23); // mostek
  add(g, box(0.5, 0.05, 0.5), woodMat(C.woodDark), 0, 0.925, 0);
  add(g, prism(0.56, 0.16, 0.56), mat(C.roofDark), 0, 1.0, 0);
}

/** Kępa kwiatów — znacznik roju motyli. */
function buildButterflyPatch(g: THREE.Group) {
  add(g, cyl(0.28, 0.32, 0.08, 10), mat(C.soil), 0, 0.04, 0);
  add(g, sphere(0.26, 8), mat(C.leaf2), 0, 0.2, 0);
  const cols = [C.flower1, C.flower2, C.flower3, C.book2];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const rr = 0.1 + (i % 3) * 0.07;
    add(g, cyl(0.006, 0.006, 0.3, 5), mat(C.leafDark), Math.cos(a) * rr, 0.35, Math.sin(a) * rr);
    add(g, sphere(0.035, 6), mat(cols[i % 4]), Math.cos(a) * rr, 0.5, Math.sin(a) * rr);
  }
}

function buildChair(g: THREE.Group) {
  add(g, box(0.48, 0.07, 0.46), woodMat(C.wood), 0, 0.45, 0);
  add(g, box(0.46, 0.6, 0.07), woodMat(C.wood), 0, 0.75, -0.2);
  for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]] as [number, number][]) {
    add(g, box(0.06, 0.44, 0.06), woodMat(C.woodDark), x, 0.22, z);
  }
}

function buildEasel(g: THREE.Group) {
  // sztaluga
  add(g, cyl(0.03, 0.04, 1.6, 5), woodMat(C.woodDark), -0.28, 0.8, 0.12, [0.12, 0, 0.14]);
  add(g, cyl(0.03, 0.04, 1.6, 5), woodMat(C.woodDark), 0.28, 0.8, 0.12, [0.12, 0, -0.14]);
  add(g, cyl(0.03, 0.04, 1.5, 5), woodMat(C.woodDark), 0, 0.75, -0.3, [-0.2, 0, 0]);
  add(g, box(0.68, 0.05, 0.08), woodMat(C.wood), 0, 0.72, 0.1);
  add(g, box(0.76, 0.6, 0.05), woodMat(C.wood), 0, 1.05, 0.08, [0.06, 0, 0]);
  add(g, box(0.66, 0.5, 0.02), mat(C.flower3), 0, 1.05, 0.11, [0.06, 0, 0]);
}

const artMats = new Map<number, THREE.MeshStandardMaterial>();
/** Materiał płótna danego stylu — współdzielony między obrazami, jak `mat()`. */
function artMat(variant: number): THREE.MeshStandardMaterial {
  let m = artMats.get(variant);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: paintingTexture(variant), roughness: 0.9 });
    artMats.set(variant, m);
  }
  return m;
}

/** Obraz w ramie z passe-partout: wisi na 1,5 m, płótno z generowanym motywem. */
function buildPainting(g: THREE.Group, ctx: BuildCtx) {
  const y = 1.5;
  add(g, box(0.92, 0.72, 0.05), woodMat(C.woodDark), 0, y, 0);
  add(g, box(0.86, 0.66, 0.02), mat(C.gold, { metalness: 0.6, roughness: 0.4 }), 0, y, 0.03);
  add(g, box(0.8, 0.6, 0.015), mat(C.paper), 0, y, 0.045);
  add(g, box(0.72, 0.52, 0.012), artMat(ctx.variant ?? 0), 0, y, 0.058);
  add(g, cyl(0.01, 0.01, 0.2, 5), mat(C.metal), 0, y + 0.42, -0.01);
}

/** Popiersie na cokole. */
function buildBust(g: THREE.Group) {
  add(g, box(0.44, 0.06, 0.44), mat(C.stone), 0, 0.03, 0);
  add(g, box(0.36, 0.94, 0.36), mat(C.stone), 0, 0.5, 0);
  add(g, box(0.46, 0.06, 0.46), mat(C.stoneDark), 0, 1.0, 0);
  add(g, box(0.5, 0.2, 0.24), mat(C.cream2), 0, 1.13, 0);
  add(g, sphere(0.11, 8), mat(C.cream2), -0.24, 1.2, 0);
  add(g, sphere(0.11, 8), mat(C.cream2), 0.24, 1.2, 0);
  add(g, cyl(0.06, 0.07, 0.14, 8), mat(C.cream2), 0, 1.29, 0);
  add(g, sphere(0.14, 12), mat(C.cream2, { flat: false }), 0, 1.47, 0);
}

/** Kominek z płomieniem i światłem. */
function buildFireplace(g: THREE.Group) {
  add(g, box(1.6, 1.2, 0.5), mat(C.stoneDark), 0, 0.6, 0);
  add(g, box(0.8, 0.72, 0.46), mat('#1d1a17'), 0, 0.4, 0.04);
  add(g, box(1.8, 0.08, 0.62), woodMat(C.wood), 0, 1.24, 0.02);
  add(g, box(1.2, 1.4, 0.42), mat(C.stone), 0, 1.98, -0.04);
  add(g, box(0.9, 0.04, 0.5), mat('#2a2622'), 0, 0.06, 0.05);
  add(g, cyl(0.06, 0.06, 0.5, 6), woodMat(C.woodDark), 0, 0.12, 0.08, [0, 0, Math.PI / 2]);
  add(g, cyl(0.05, 0.05, 0.46, 6), woodMat(C.woodDark), 0.04, 0.22, 0.12, [0, 0.4, Math.PI / 2]);
  add(g, cone(0.14, 0.4, 6), mat('#ff7a2e', { emissive: '#ff4d12' }), -0.06, 0.38, 0.1);
  add(g, cone(0.09, 0.3, 5), mat('#ffd36b', { emissive: '#ffc44d' }), 0.08, 0.36, 0.14);
  const light = new THREE.PointLight('#ff9a4a', 5, 6, 2);
  light.position.set(0, 0.5, 0.35);
  g.add(light);
}

/** Wspólny szkielet fotela i sofy: siedzisko, oparcie, podłokietniki, poduszki, nóżki. */
function seating(g: THREE.Group, width: number, cushions: number) {
  add(g, box(width, 0.34, 0.8), mat(C.fabric), 0, 0.27, 0);
  add(g, box(width, 0.5, 0.2), mat(C.fabric), 0, 0.65, -0.3);
  for (const x of [-width / 2 + 0.07, width / 2 - 0.07]) add(g, box(0.14, 0.3, 0.8), mat(C.fabric), x, 0.55, 0);
  const cw = (width - 0.28 - 0.04 * (cushions - 1)) / cushions;
  for (let i = 0; i < cushions; i++) {
    const x = -width / 2 + 0.14 + cw / 2 + i * (cw + 0.04);
    add(g, box(cw, 0.12, 0.62), mat(C.fabric2), x, 0.5, 0.05);
    add(g, box(cw - 0.06, 0.34, 0.1), mat(C.fabric2), x, 0.68, -0.22);
  }
  for (const x of [-width / 2 + 0.08, width / 2 - 0.08]) for (const z of [-0.32, 0.32]) add(g, cyl(0.03, 0.03, 0.1, 6), woodMat(C.woodDark), x, 0.05, z);
}

function buildArmchair(g: THREE.Group) {
  seating(g, 0.9, 1);
}

function buildSofa(g: THREE.Group) {
  seating(g, 1.9, 3);
}

/** Łóżko z kołdrą, poduszkami i wezgłowiem. */
function buildBed(g: THREE.Group) {
  add(g, box(1.6, 0.3, 2.1), woodMat(C.woodDark), 0, 0.2, 0);
  add(g, box(1.5, 0.22, 2.0), mat(C.linen), 0, 0.46, 0);
  add(g, box(1.52, 0.1, 1.3), mat('#a3b7c9'), 0, 0.6, 0.3);
  for (const x of [-0.4, 0.4]) add(g, box(0.55, 0.14, 0.4), mat(C.paper), x, 0.62, -0.72);
  add(g, box(1.6, 0.9, 0.08), woodMat(C.woodDark), 0, 0.75, -1.06);
  for (const x of [-0.72, 0.72]) for (const z of [-0.98, 0.98]) add(g, box(0.08, 0.1, 0.08), woodMat(C.woodDark), x, 0.05, z);
}

/** Biurko z szufladami i lampką. */
function buildDesk(g: THREE.Group) {
  add(g, box(1.4, 0.06, 0.7), woodMat(C.wood), 0, 0.75, 0);
  for (const x of [-0.45, 0.45]) {
    add(g, box(0.45, 0.66, 0.6), woodMat(C.woodDark), x, 0.36, 0);
    for (let i = 0; i < 3; i++) add(g, box(0.3, 0.03, 0.02), mat(C.cream2), x, 0.16 + i * 0.2, 0.31);
  }
  add(g, cyl(0.06, 0.08, 0.03, 8), mat(C.metal), -0.45, 0.8, -0.2);
  add(g, cyl(0.012, 0.012, 0.36, 6), mat(C.metal), -0.45, 0.97, -0.2);
  add(g, cone(0.11, 0.14, 8), mat(C.glow, { emissive: '#f4d27a' }), -0.45, 1.16, -0.2, [Math.PI, 0, 0]);
  const light = new THREE.PointLight('#ffe2b0', 1.2, 3, 2);
  light.position.set(-0.45, 1.1, -0.2);
  g.add(light);
}

/** Kredens z drzwiczkami. */
function buildSideboard(g: THREE.Group) {
  add(g, box(1.4, 0.86, 0.5), woodMat(C.woodDark), 0, 0.47, 0);
  add(g, box(1.46, 0.04, 0.54), woodMat(C.wood), 0, 0.92, 0);
  for (const x of [-0.34, 0.34]) {
    add(g, box(0.6, 0.66, 0.02), woodMat(C.wood), x, 0.45, 0.26);
    add(g, box(0.03, 0.1, 0.02), mat(C.gold, { metalness: 0.6, roughness: 0.4 }), x + (x < 0 ? 0.24 : -0.24), 0.45, 0.28);
  }
  for (const x of [-0.6, 0.6]) for (const z of [-0.2, 0.2]) add(g, box(0.06, 0.08, 0.06), woodMat(C.woodDark), x, 0.04, z);
}

/** Szafka kuchenna: korpus z drzwiczkami, kamienny blat i wpuszczony zlew. */
function buildCounter(g: THREE.Group) {
  add(g, box(1.14, 0.82, 0.54), woodMat(C.wood), 0, 0.45, 0);
  const top = add(g, box(1.2, 0.05, 0.6), mat(C.stone), 0, 0.89, 0);
  top.userData.floorSurface = true; // na blacie da się postawić naczynia
  for (const x of [-0.28, 0.28]) {
    add(g, box(0.5, 0.6, 0.02), woodMat(C.woodDark), x, 0.42, 0.28);
    add(g, box(0.03, 0.09, 0.02), mat(C.metal, { metalness: 0.6, roughness: 0.4 }), x + (x < 0 ? 0.2 : -0.2), 0.42, 0.3);
  }
  // zlew: płytka niecka wpuszczona w blat, z baterią przy tylnej krawędzi
  add(g, box(0.42, 0.12, 0.34), mat(C.metal, { metalness: 0.5, roughness: 0.35 }), 0.32, 0.86, 0);
  add(g, cyl(0.02, 0.02, 0.22, 8), mat(C.metal, { metalness: 0.6, roughness: 0.3 }), 0.32, 1.02, -0.17);
  add(g, box(0.03, 0.03, 0.12), mat(C.metal, { metalness: 0.6, roughness: 0.3 }), 0.32, 1.12, -0.11);
  for (const x of [-0.5, 0.5]) for (const z of [-0.2, 0.2]) add(g, box(0.06, 0.08, 0.06), woodMat(C.woodDark), x, 0.04, z);
}

/** Piec kaflowy z paleniskiem, płytą i rurą pod sufit. */
function buildStove(g: THREE.Group) {
  add(g, box(0.66, 0.9, 0.56), mat(C.cream2), 0, 0.47, 0);
  // fugi między kaflami — bez nich korpus wygląda jak zwykłe pudełko
  for (let r = 0; r < 3; r++) for (const x of [-0.16, 0.16]) add(g, box(0.3, 0.005, 0.005), mat(C.stoneDark), x, 0.18 + r * 0.26, 0.283);
  add(g, box(0.7, 0.05, 0.6), mat(C.metal), 0, 0.94, 0);
  for (const x of [-0.16, 0.16]) add(g, cyl(0.1, 0.1, 0.02, 12), mat(C.dark), x, 0.97, -0.08);
  add(g, box(0.34, 0.3, 0.03), mat(C.dark), 0, 0.36, 0.29);
  add(g, box(0.26, 0.16, 0.01), mat(C.glow, { emissive: '#ff8a3d' }), 0, 0.36, 0.31);
  add(g, box(0.04, 0.1, 0.02), mat(C.metal, { metalness: 0.6, roughness: 0.4 }), 0.14, 0.36, 0.32);
  add(g, cyl(0.08, 0.08, 1.1, 10), mat(C.metal), 0, 1.5, -0.2);
  const fire = new THREE.PointLight('#ff9a4d', 1.4, 4, 2);
  fire.position.set(0, 0.4, 0.3);
  g.add(fire);
}

/** Zegar stojący z tarczą i wahadłem. */
function buildClock(g: THREE.Group) {
  add(g, box(0.5, 2.0, 0.3), woodMat(C.woodDark), 0, 1.0, 0);
  add(g, box(0.56, 0.08, 0.34), woodMat(C.wood), 0, 2.04, 0);
  add(g, box(0.18, 0.9, 0.02), mat('#1d1a17'), 0, 0.85, 0.15);
  add(g, cyl(0.012, 0.012, 0.6, 5), mat(C.gold, { metalness: 0.7, roughness: 0.3 }), 0, 0.95, 0.16);
  add(g, cyl(0.06, 0.06, 0.02, 12), mat(C.gold, { metalness: 0.7, roughness: 0.3 }), 0, 0.62, 0.16, [Math.PI / 2, 0, 0]);
  add(g, cyl(0.18, 0.18, 0.03, 16), mat(C.paper), 0, 1.68, 0.16, [Math.PI / 2, 0, 0]);
  add(g, box(0.02, 0.13, 0.01), mat(C.dark), 0, 1.74, 0.18);
  add(g, box(0.1, 0.02, 0.01), mat(C.dark), 0.05, 1.68, 0.18);
}

/** Lustro w złotej ramie na stojaku (bez odbić — tafla lśni światłem). */
function buildMirror(g: THREE.Group) {
  const gold = mat(C.gold, { metalness: 0.8, roughness: 0.3 });
  add(g, box(0.8, 1.4, 0.05), gold, 0, 1.0, 0, [-0.08, 0, 0]);
  add(g, box(0.68, 1.28, 0.02), mat('#dbe6ee', { metalness: 0.9, roughness: 0.05, flat: false }), 0, 1.0, 0.03, [-0.08, 0, 0]);
  for (const x of [-0.3, 0.3]) add(g, box(0.05, 0.4, 0.4), woodMat(C.woodDark), x, 0.2, -0.08);
}

/** Wazon z pięcioma kwiatami. */
function buildVase(g: THREE.Group) {
  add(g, cyl(0.1, 0.07, 0.36, 10), mat('#8fa3b5', { roughness: 0.5 }), 0, 0.18, 0);
  add(g, cyl(0.05, 0.09, 0.1, 10), mat('#8fa3b5', { roughness: 0.5 }), 0, 0.41, 0);
  const petals = [C.flower1, C.flower2, C.flower3, C.flower1, C.flower2];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const tilt = 0.25;
    add(g, cyl(0.006, 0.006, 0.4, 4), mat(C.leaf2), Math.sin(a) * 0.06, 0.6, Math.cos(a) * 0.06, [Math.cos(a) * tilt, 0, -Math.sin(a) * tilt]);
    add(g, sphere(0.05, 7), mat(petals[i]), Math.sin(a) * 0.14, 0.8, Math.cos(a) * 0.14);
  }
}

/** Zasłony z karniszem i lambrekinem. */
function buildCurtains(g: THREE.Group) {
  add(g, cyl(0.02, 0.02, 1.9, 8), mat(C.gold, { metalness: 0.7, roughness: 0.3 }), 0, 2.3, 0, [0, 0, Math.PI / 2]);
  for (const x of [-0.65, 0.65]) {
    add(g, box(0.5, 2.2, 0.1), mat(C.velvet), x, 1.15, 0);
    add(g, box(0.56, 0.1, 0.12), mat(C.velvet), x, 0.06, 0);
    add(g, box(0.4, 0.08, 0.12), mat(C.gold, { metalness: 0.7, roughness: 0.3 }), x, 1.0, 0.02);
  }
  add(g, box(1.9, 0.18, 0.14), mat(C.velvet), 0, 2.26, 0.01);
}

function buildRug(g: THREE.Group) {
  add(g, box(2.2, 0.03, 1.5), mat('#b6836b'), 0, 0.015, 0);
  add(g, box(1.9, 0.035, 1.2), mat('#c99a80'), 0, 0.02, 0);
  add(g, box(1.1, 0.04, 0.6), mat('#8d6455'), 0, 0.024, 0);
}

function buildCandle(g: THREE.Group) {
  add(g, cyl(0.16, 0.22, 0.08, 10), mat(C.metal), 0, 0.04, 0);
  add(g, cyl(0.04, 0.05, 1.0, 8), mat(C.metal), 0, 0.55, 0);
  add(g, cyl(0.22, 0.1, 0.06, 10), mat(C.metal), 0, 1.06, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const x = Math.cos(a) * 0.16;
    const z = Math.sin(a) * 0.16;
    add(g, cyl(0.045, 0.05, 0.24, 7), mat(C.paper), x, 1.2, z);
    add(g, sphere(0.05, 6), mat(C.glow, { emissive: '#ffcf6b' }), x, 1.36, z);
  }
  const light = new THREE.PointLight('#ffce85', 3, 6, 2);
  light.position.set(0, 1.4, 0);
  g.add(light);
}

// ---------- krajobraz ----------

function buildMountain(g: THREE.Group) {
  add(g, cone(3.2, 5.6, 7), mat(C.rock), 0, 2.8, 0, [0, 0.3, 0]);
  add(g, cone(2.1, 4.0, 6), mat(C.rockDark), 2.1, 2.0, 1.1, [0, 0.9, 0]);
  add(g, cone(1.6, 3.0, 6), mat(C.rock), -2.0, 1.5, -1.2, [0, 0.4, 0]);
  // czapy śnieżne
  add(g, cone(1.0, 1.7, 7), mat(C.snow), 0, 4.7, 0, [0, 0.3, 0]);
  add(g, cone(0.62, 1.1, 6), mat(C.snow), 2.1, 3.45, 1.1, [0, 0.9, 0]);
  add(g, dodeca(1.5, 0), mat(C.rockDark), -2.6, 0.5, 1.9);
}

function buildVolcano(g: THREE.Group) {
  add(g, cyl(1.15, 3.3, 3.6, 9), mat(C.volcano), 0, 1.8, 0);
  add(g, cyl(1.05, 1.15, 0.35, 9), mat(C.volcanoDark), 0, 3.6, 0);
  add(g, cyl(0.85, 0.85, 0.16, 9), mat(C.lava, { emissive: '#ff4b16' }), 0, 3.68, 0);
  // strugi lawy na zboczu
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const m = add(g, box(0.28, 2.6, 0.12), mat(C.lava, { emissive: '#e03c10' }), Math.cos(a) * 1.5, 2.1, Math.sin(a) * 1.5, [0.28, -a, 0]);
    m.rotation.z = Math.cos(a) * 0.22;
  }
  add(g, dodeca(0.9, 0), mat(C.volcanoDark), 2.6, 0.35, 1.4);
  add(g, dodeca(0.6, 0), mat(C.volcanoDark), -2.4, 0.25, -1.6);
}

function buildRock(g: THREE.Group) {
  const a = add(g, dodeca(0.8, 0), mat(C.rockLight), 0, 0.52, 0, [0.3, 0.6, 0.15]);
  a.scale.set(1.25, 0.8, 1.05);
  const b = add(g, dodeca(0.5, 0), mat(C.rock), 0.75, 0.32, 0.35, [0.1, 1.2, 0.3]);
  b.scale.set(1.1, 0.75, 1);
  add(g, dodeca(0.3, 0), mat(C.rockDark), -0.7, 0.2, -0.4, [0.4, 0.2, 0.6]);
}

function buildHill(g: THREE.Group) {
  const dome = new THREE.SphereGeometry(2.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const m = add(g, dome, mat(C.leaf2), 0, 0, 0);
  m.scale.set(1, 0.42, 1);
  add(g, dodeca(0.45, 0), mat(C.leafDark), 1.2, 0.85, 0.5);
  add(g, dodeca(0.35, 0), mat(C.leaf), -1.1, 0.8, -0.6);
  add(g, cyl(0.1, 0.14, 0.7, 6), woodMat(C.woodDark), 0.2, 1.2, -0.3);
  add(g, dodeca(0.55, 0), mat(C.leafDark), 0.2, 1.85, -0.3);
}

function buildPond(g: THREE.Group) {
  add(g, cyl(2.05, 2.2, 0.3, 18), mat(C.stoneDark), 0, 0.15, 0);
  add(g, cyl(1.85, 1.85, 0.1, 18), mat(C.water, { flat: false, roughness: 0.25 }), 0, 0.26, 0);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    add(g, cyl(0.03, 0.04, 0.9, 5), mat(C.leafDark), Math.cos(a) * 1.6, 0.65, Math.sin(a) * 1.6, [0.12, 0, 0.08]);
  }
  add(g, dodeca(0.35, 0), mat(C.rock), 1.7, 0.35, -1.2);
}

function buildWaterfall(g: THREE.Group) {
  add(g, box(2.6, 3.4, 1.0), mat(C.rock), 0, 1.7, -0.5);
  add(g, box(2.9, 0.5, 1.3), mat(C.rockDark), 0, 3.5, -0.5);
  add(g, box(1.3, 3.3, 0.1), mat(C.water, { flat: false, roughness: 0.2 }), 0, 1.65, 0.03);
  add(g, cyl(1.5, 1.6, 0.28, 16), mat(C.stoneDark), 0, 0.14, 1.0);
  add(g, cyl(1.35, 1.35, 0.1, 16), mat(C.water, { flat: false, roughness: 0.25 }), 0, 0.25, 1.0);
  add(g, dodeca(0.4, 0), mat(C.rock), 1.5, 0.3, 0.6);
}

const RUNWAY_LEN = 34;
const RUNWAY_W = 8;

/** Pas startowy wzdłuż lokalnej osi X: płyta betonowa, progi, przerywana oś i światła krawędziowe. */
function buildRunway(g: THREE.Group) {
  const h = 0.03; // jak ścieżki: bez bryły kolizji, więc koła i stopy nie mogą tonąć głębiej niż to widać
  const slab = add(g, box(RUNWAY_LEN, h, RUNWAY_W), mat('#4b4d52', { roughness: 1 }), 0, h / 2, 0);
  slab.castShadow = false;
  const paint = mat('#f2f0e6', { roughness: 0.9 });
  const yp = h + 0.004; // farba tuż nad betonem, żeby nie migotała z płytą
  for (let x = -RUNWAY_LEN / 2 + 5; x < RUNWAY_LEN / 2 - 4; x += 3) add(g, box(1.6, 0.008, 0.18), paint, x, yp, 0).castShadow = false;
  for (const end of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = (i + 0.5) * 0.8;
      for (const s of [-1, 1]) add(g, box(2.2, 0.008, 0.4), paint, end * (RUNWAY_LEN / 2 - 1.8), yp, s * z).castShadow = false;
    }
  }
  const lamp = mat('#ffd27a', { emissive: '#ffb347' });
  for (let x = -RUNWAY_LEN / 2 + 1; x <= RUNWAY_LEN / 2 - 1; x += 4) {
    for (const s of [-1, 1]) add(g, box(0.18, 0.18, 0.18), lamp, x, h + 0.09, s * (RUNWAY_W / 2 + 0.3));
  }
}

// ---------- miasto: wieżowce, ekrany, neony ----------

/** Kafel elewacji wieżowca: 4 okna w poziomie na 5 m i 16 w pionie na 40 m — okno co 1,25 × 2,5 m niezależnie od bryły. */
const WIN_TILE_W = 5;
const WIN_TILE_H = 40;

const windowMats = new Map<number, THREE.MeshStandardMaterial>();
/**
 * Elewacja z siatką okien, część zapalonych na ciepło albo zimno. Ta sama kanwa jest mapą koloru i emisji,
 * więc nocą okna świecą bez osobnych brył na każde z nich. Materiał jest współdzielony jak te z `mat()`
 * (nie zwalnia go `disposeObject`); wariant zmienia układ zapalonych okien między sąsiednimi wieżami.
 */
function windowsMat(variant: number) {
  let m = windowMats.get(variant);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a1f28';
  ctx.fillRect(0, 0, c.width, c.height);
  let seed = (variant * 7919 + 17) >>> 0;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const lit = ['#ffe3a6', '#d2ecff', '#9fd9ff', '#ffd07a', '#f3f7ff'];
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 4; col++) {
      const on = rand() < 0.55;
      ctx.fillStyle = on ? lit[Math.floor(rand() * lit.length)] : '#262d3a';
      ctx.globalAlpha = on ? 0.55 + rand() * 0.45 : 1;
      ctx.fillRect(col * 32 + 5, row * 32 + 4, 22, 24);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.75, roughness: 0.35, metalness: 0.3 });
  windowMats.set(variant, m);
  return m;
}

const screenMats = new Map<number, THREE.MeshStandardMaterial>();
const SLOGANS = ['MNEME', 'NEON', 'TAXI', 'ネオン', 'DATA', '記憶'];
/** Ekran reklamowy: ciemne tło z ukośnymi pasami i hasło w dwóch kolorach neonu; świeci sam z siebie. */
function screenMat(variant: number) {
  let m = screenMats.get(variant);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0b0f1a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = 0.35;
  for (let i = -6; i < 14; i++) {
    ctx.fillStyle = i % 2 ? '#ff2bd6' : '#2be8ff';
    ctx.beginPath();
    ctx.moveTo(i * 48, 0);
    ctx.lineTo(i * 48 + 18, 0);
    ctx.lineTo(i * 48 + 18 - 120, 256);
    ctx.lineTo(i * 48 - 120, 256);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 120px sans-serif';
  ctx.fillStyle = '#ff2bd6';
  ctx.fillText(SLOGANS[variant % SLOGANS.length], 262, 134);
  ctx.fillStyle = '#e9fbff';
  ctx.fillText(SLOGANS[variant % SLOGANS.length], 256, 128);
  ctx.font = 'bold 34px sans-serif';
  ctx.fillStyle = '#2be8ff';
  ctx.fillText('● ● ●  24h  ● ● ●', 256, 216);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1, roughness: 0.5 });
  screenMats.set(variant, m);
  return m;
}

function neonMat(color: string) {
  return mat(color, { emissive: color, roughness: 0.4 });
}

/** Bryła wieżowca z oknami na ścianach; `y0` to spód. Kafel skaluje się z bryłą, więc okna nie rozciągają się. */
function towerBlock(g: THREE.Group, w: number, h: number, d: number, x: number, y0: number, z: number, variant: number) {
  return add(g, scaleUv(box(w, h, d), w / WIN_TILE_W, h / WIN_TILE_H), windowsMat(variant), x, y0 + h / 2, z);
}

/** Neonowa obwódka wokół prostokąta w × d na wysokości y — cztery rurki o grubości t tuż przy ścianach. */
function neonRing(g: THREE.Group, w: number, d: number, y: number, t: number, color: string) {
  const m = neonMat(color);
  for (const s of [-1, 1]) {
    add(g, box(w + 2 * t, t, t), m, 0, y, s * (d / 2 + t / 2)).castShadow = false;
    add(g, box(t, t, d), m, s * (w / 2 + t / 2), y, 0).castShadow = false;
  }
}

/** Wieżowiec: cokół z wejściem, szklana wieża 26 m, neonowe pasy i pionowe rurki na narożach, iglica z czerwonym światłem. */
function buildSkyscraper(g: THREE.Group, ctx: BuildCtx) {
  const v = ctx.variant ?? 0;
  const dark = mat('#262a31', { roughness: 0.7, metalness: 0.2 });
  add(g, box(8, 3, 8), dark, 0, 1.5, 0);
  add(g, box(8.4, 0.3, 8.4), mat('#3a3f47', { roughness: 0.6 }), 0, 3.1, 0);
  add(g, box(3.2, 2.4, 0.08), glassMat(), 0, 1.3, 4.02);
  add(g, box(3.6, 0.25, 0.14), neonMat(C.neon2), 0, 2.72, 4.06).castShadow = false;
  towerBlock(g, 6, 26, 6, 0, 3.25, 0, v);
  const edge = neonMat(v % 2 ? C.neon1 : C.neon2);
  for (const s of [-1, 1]) add(g, box(0.16, 26, 0.16), edge, s * 3.06, 16.25, 3.06).castShadow = false;
  neonRing(g, 6, 6, 9, 0.14, C.neon1);
  neonRing(g, 6, 6, 20, 0.14, C.neon2);
  neonRing(g, 6, 6, 29.1, 0.16, C.neon1);
  add(g, box(6.4, 0.5, 6.4), dark, 0, 29.5, 0);
  add(g, box(2.4, 1.2, 2.4), dark, 0, 30.35, 0);
  add(g, cyl(0.06, 0.1, 6, 6), mat(C.metal), 0, 33.9, 0);
  add(g, sphere(0.2, 8), mat('#ff3b4a', { emissive: '#ff2030' }), 0, 37, 0);
}

/** Megawieżowiec: trzy cofające się bryły na cokole, ekran reklamowy na dolnej i neony wzdłuż tarasów. */
function buildMegatower(g: THREE.Group, ctx: BuildCtx) {
  const v = ctx.variant ?? 0;
  const dark = mat('#262a31', { roughness: 0.7, metalness: 0.2 });
  add(g, box(12, 4, 12), dark, 0, 2, 0);
  add(g, box(12.4, 0.3, 12.4), mat('#3a3f47', { roughness: 0.6 }), 0, 4.1, 0);
  add(g, box(4, 3.2, 0.08), glassMat(), 0, 1.7, 6.02);
  add(g, box(4.6, 0.25, 0.14), neonMat(C.neon1), 0, 3.5, 6.06).castShadow = false;
  const tiers: [number, number, number][] = [[10, 12, 4.25], [7.5, 12, 16.25], [5, 9, 28.25]];
  tiers.forEach(([w, h, y0], i) => {
    towerBlock(g, w, h, w, 0, y0, 0, v + i);
    neonRing(g, w, w, y0 + h - 0.1, 0.14, i % 2 ? C.neon2 : C.neon1);
    add(g, box(w + 0.4, 0.3, w + 0.4), dark, 0, y0 + h + 0.15, 0);
  });
  // ekran na fasadzie dolnej bryły, w ciemnej ramie
  add(g, box(7, 4, 0.2), dark, 0, 11, 5.1);
  add(g, box(6.4, 3.4, 0.06), screenMat(v), 0, 11, 5.22).castShadow = false;
  add(g, box(2, 1, 2), dark, 0, 37.9, 0);
  for (const s of [-1, 1]) add(g, cyl(0.05, 0.08, 4, 6), mat(C.metal), s * 1.6, 40.2, -1.6);
  add(g, cyl(0.08, 0.12, 7, 6), mat(C.metal), 0, 41.8, 0);
  add(g, sphere(0.22, 8), mat('#ff3b4a', { emissive: '#ff2030' }), 0, 45.4, 0);
}

/**
 * Blok: powłoka domku (te same wymiary i drzwi) z płaskim dachem, ciemną elewacją, neonem nad wejściem
 * i klimatyzatorami na dachu. Kolor neonu zależy od wariantu, żeby sąsiednie bloki się różniły.
 */
function buildBlock(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.block;
  const { w, d, h } = spec.inner;
  const dark = mat('#2a2e36', { roughness: 0.7, metalness: 0.2 });
  const concrete = mat('#3a3d44', { roughness: 0.9 });
  basePlate(g, ctx, 'block', w + 0.5, d + 0.5, 0.16, 0.08, 0, concrete);
  shellBox(g, ctx, 'block', dark, concrete, mat(C.metal));
  shellEntryRamp(g, spec, d / 2 + 0.8);
  const v = ctx.variant ?? 0;
  const door = spec.door!;
  add(g, box(1.1, 0.08, 0.06), neonMat(v % 2 ? C.neon2 : C.neon1), door.x, spec.floorY + door.h + 0.18, d / 2 + SHELL_WALL_T + 0.04).castShadow = false;
  // dach jest w grupie, którą klik w budynek chowa; `top` to szczyt muru parteru, wyższe piętra podnoszą grupę
  const roof = roofGroup(g, roofLift(ctx, spec));
  const top = spec.floorY + h;
  add(roof, box(w + 0.6, 0.22, d + 0.6), dark, 0, top + 0.1, 0);
  neonRing(roof, w + 0.6, d + 0.6, top + 0.28, 0.06, v % 2 ? C.neon1 : C.neon2);
  const unit = mat('#4a4f58', { roughness: 0.6, metalness: 0.3 });
  add(roof, box(0.6, 0.4, 0.5), unit, w * 0.25, top + 0.41, -d * 0.2);
  add(roof, box(0.5, 0.35, 0.5), unit, -w * 0.3, top + 0.38, d * 0.15);
  add(roof, cyl(0.03, 0.04, 1.6, 6), mat(C.metal), -w * 0.35, top + 1.0, -d * 0.3);
  add(roof, sphere(0.07, 6), mat('#ff3b4a', { emissive: '#ff2030' }), -w * 0.35, top + 1.85, -d * 0.3);
}

/** Ekran reklamowy na dwóch słupach; przód (+Z) świeci. */
function buildBillboard(g: THREE.Group, ctx: BuildCtx) {
  const metal = mat(C.metal);
  for (const s of [-1, 1]) {
    add(g, cyl(0.12, 0.16, 0.2, 8), metal, s * 1.7, 0.1, 0);
    add(g, cyl(0.07, 0.09, 4.2, 8), metal, s * 1.7, 2.2, 0);
  }
  add(g, box(4.4, 2.5, 0.2), mat('#262a31', { roughness: 0.7, metalness: 0.2 }), 0, 5.35, 0);
  add(g, box(4.1, 2.2, 0.06), screenMat(ctx.variant ?? 0), 0, 5.35, 0.12).castShadow = false;
  neonRing(g, 4.1, 0.06, 4.2, 0.05, C.neon2);
  neonRing(g, 4.1, 0.06, 6.5, 0.05, C.neon2);
}

/** Neon: szyld na słupie z rurkami ułożonymi w dwa znaki (glify z `RUNES`) i błękitną obwódką; przód to +Z. */
function buildNeon(g: THREE.Group, ctx: BuildCtx) {
  const metal = mat(C.metal);
  add(g, cyl(0.14, 0.18, 0.16, 8), metal, 0, 0.08, 0);
  add(g, cyl(0.05, 0.06, 3.2, 8), metal, 0, 1.6, 0);
  add(g, box(1.5, 1.0, 0.08), mat('#1c1f26', { roughness: 0.6 }), 0, 3.1, 0);
  const border = neonMat(C.neon2);
  for (const s of [-1, 1]) {
    add(g, box(1.5, 0.04, 0.04), border, 0, 3.1 + s * 0.46, 0.05).castShadow = false;
    add(g, box(0.04, 0.96, 0.04), border, s * 0.72, 3.1, 0.05).castShadow = false;
  }
  const tube = neonMat(C.neon1);
  const v = ctx.variant ?? 0;
  const glyphs = [RUNES[v % RUNES.length], RUNES[(v * 7 + 3) % RUNES.length]];
  glyphs.forEach((glyph, gi) => {
    const cx = gi ? 0.34 : -0.34;
    const size = 0.6;
    for (const line of glyph) {
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1];
        const [bx, by] = line[i];
        const x0 = cx + (ax - 0.5) * size;
        const y0 = 3.1 + (0.5 - ay) * size;
        const x1 = cx + (bx - 0.5) * size;
        const y1 = 3.1 + (0.5 - by) * size;
        const len = Math.hypot(x1 - x0, y1 - y0);
        add(g, box(len + 0.045, 0.045, 0.045), tube, (x0 + x1) / 2, (y0 + y1) / 2, 0.07, [0, 0, Math.atan2(y1 - y0, x1 - x0)]).castShadow = false;
      }
    }
  });
  const light = new THREE.PointLight(C.neon1, 4, 8, 2);
  light.position.set(0, 3.0, 0.6);
  g.add(light);
}

/** Latarnia uliczna: słup z wysięgnikiem nad jezdnią (w stronę +Z) i zimnym światłem. */
function buildStreetlamp(g: THREE.Group) {
  const metal = mat(C.metal);
  add(g, cyl(0.14, 0.2, 0.24, 8), metal, 0, 0.12, 0);
  add(g, cyl(0.05, 0.08, 5.2, 8), metal, 0, 2.6, 0);
  add(g, box(0.08, 0.08, 1.5), metal, 0, 5.16, 0.72);
  add(g, box(0.5, 0.12, 0.34), mat('#2b2f36', { roughness: 0.5, metalness: 0.3 }), 0, 5.1, 1.45);
  add(g, box(0.4, 0.03, 0.24), mat('#dff1ff', { emissive: '#cfe8ff' }), 0, 5.03, 1.45).castShadow = false;
  const light = new THREE.PointLight('#cfe6ff', 5, 12, 2);
  light.position.set(0, 4.9, 1.45);
  g.add(light);
}

/**
 * Latająca taksówka: żółty kadłub bez kół na czterech silnikach ze świecącymi dyszami, przeszklona kabina,
 * szachownica na burtach i szyld na dachu. Przód to −Z (jak samolot); na postoju stoi na płozach.
 */
function buildHovercar(g: THREE.Group) {
  const body = mat('#f0b929', { roughness: 0.5, metalness: 0.15 });
  const dark = mat('#23252b', { roughness: 0.6, metalness: 0.3 });
  const metal = mat(C.metal);
  add(g, box(1.9, 0.3, 4.0), dark, 0, 0.62, -0.2);
  add(g, box(2.0, 0.65, 4.4), body, 0, 1.08, -0.2);
  add(g, box(1.6, 0.4, 0.5), body, 0, 1.0, -2.6);
  // kabina: szyby między słupkami, dach z szyldem
  add(g, box(1.62, 1.2, 2.2), glassMat(), 0, 2.0, -0.1);
  for (const x of [-0.79, 0.79]) for (const z of [-1.18, 0.98]) add(g, box(0.08, 1.2, 0.08), dark, x, 2.0, z);
  add(g, box(1.74, 0.08, 2.3), body, 0, 2.64, -0.1);
  add(g, box(0.62, 0.22, 0.32), mat('#ffe27a', { emissive: '#ffcc44' }), 0, 2.79, -0.1);
  // wnętrze: fotel, deska rozdzielcza, wolant
  add(g, box(0.62, 0.12, 0.52), mat(C.velvet), 0, 1.46, 0.25);
  add(g, box(0.62, 0.5, 0.1), mat(C.velvet), 0, 1.75, 0.52);
  add(g, box(1.4, 0.25, 0.3), dark, 0, 1.52, -0.95);
  add(g, box(0.5, 0.05, 0.05), mat('#2be8ff', { emissive: '#2be8ff' }), 0, 1.66, -0.95).castShadow = false;
  add(g, cyl(0.03, 0.03, 0.4, 6), metal, 0, 1.6, -0.55, [0.6, 0, 0]);
  add(g, box(0.34, 0.05, 0.14), dark, 0, 1.78, -0.66);
  // szachownica na burtach
  for (let i = 0; i < 10; i++) {
    for (const s of [-1, 1]) add(g, box(0.05, 0.16, 0.16), mat(i % 2 ? '#111318' : '#f2f2f0', { roughness: 0.6 }), s * 1.02, 1.28, -1.7 + i * 0.3).castShadow = false;
  }
  // światła, silniki tylne, dysze nośne i płozy
  for (const s of [-1, 1]) {
    add(g, box(0.3, 0.12, 0.05), mat('#fff6d5', { emissive: '#fff1c4' }), s * 0.6, 1.12, -2.86).castShadow = false;
    add(g, cyl(0.24, 0.26, 0.7, 10), dark, s * 0.6, 1.1, 2.2, [Math.PI / 2, 0, 0]);
    add(g, cyl(0.18, 0.18, 0.04, 10), mat('#ff8a3d', { emissive: '#ff6a1a' }), s * 0.6, 1.1, 2.57, [Math.PI / 2, 0, 0]).castShadow = false;
    for (const z of [-1.4, 1.1]) {
      add(g, cyl(0.34, 0.3, 0.42, 10), dark, s * 1.1, 0.72, z);
      add(g, cyl(0.24, 0.24, 0.04, 10), mat('#7fe9ff', { emissive: '#3fd8ff' }), s * 1.1, 0.5, z).castShadow = false;
    }
    add(g, box(0.14, 0.12, 2.6), metal, s * 0.75, 0.06, -0.2);
    for (const z of [-1.2, 0.8]) add(g, box(0.1, 0.4, 0.1), metal, s * 0.75, 0.3, z);
  }
  const light = new THREE.PointLight('#4fd8ff', 2, 5, 2);
  light.position.set(0, 0.4, -0.2);
  g.add(light);
}

const BUILDERS: Record<string, (g: THREE.Group, ctx: BuildCtx) => void> = {
  wall: buildWall,
  pathway: buildPath,
  runway: buildRunway,
  skyscraper: buildSkyscraper,
  megatower: buildMegatower,
  billboard: buildBillboard,
  neon: buildNeon,
  streetlamp: buildStreetlamp,
  hovercar: buildHovercar,
  globe: buildGlobe,
  dishes: buildDishes,
  fireflies: buildFireflyJar,
  insects: buildBeehive,
  butterflies: buildButterflyPatch,
  door: buildDoor,
  window: buildWindow,
  balcony: buildBalcony,
  terrace: buildTerrace,
  ceiling_lamp: buildCeilingLamp,
  stairs: buildStairs,
  palace: buildPalace,
  library: buildLibrary,
  temple: buildTemple,
  tower: buildTower,
  house: buildHouse,
  block: buildBlock,
  gazebo: buildGazebo,
  fountain: buildFountain,
  bench: buildBench,
  lantern: buildLantern,
  books: buildBooks,
  statue: buildStatue,
  obelisk: buildObelisk,
  chest: buildChest,
  signpost: buildSignpost,
  well: buildWell,
  plane: buildPlane,
  horse: buildAssetMount('horse'),
  dragon: buildDragonMount,
  sandworm: buildSandworm,
  tree: buildTree,
  cypress: buildCypress,
  bush: buildBush,
  flowers: buildFlowers,
  palm: buildPalm,
  mountain: buildMountain,
  volcano: buildVolcano,
  rock: buildRock,
  hill: buildHill,
  pond: buildPond,
  waterfall: buildWaterfall,
  table: buildTable,
  counter: buildCounter,
  stove: buildStove,
  shelf: buildShelf,
  chair: buildChair,
  painting: buildPainting,
  easel: buildEasel,
  bust: buildBust,
  fireplace: buildFireplace,
  armchair: buildArmchair,
  sofa: buildSofa,
  bed: buildBed,
  desk: buildDesk,
  sideboard: buildSideboard,
  clock: buildClock,
  mirror: buildMirror,
  vase: buildVase,
  curtains: buildCurtains,
  rug: buildRug,
  candle: buildCandle,
  torch: buildTorch,
  lampion: buildLampion,
  campfire: buildCampfire,
  gate: buildGate,
  spawn_bird: buildSpawnMarker('bird'),
  spawn_dog: buildSpawnMarker('dog'),
  spawn_cat: buildSpawnMarker('cat'),
  spawn_squirrel: buildSpawnMarker('squirrel'),
  spawn_wolf: buildSpawnMarker('wolf'),
  spawn_dragon: buildSpawnMarker('dragon'),
};

/**
 * Bryła kolizji skrzydła drzwi obiektowych (typ `door`) w stanie zamkniętym, w lokalnych
 * współrzędnych modelu — liczona wprost ze stałych w `buildDoor`.
 */
export const DOOR_LEAF_LOCAL = { size: [0.97, 2.07, 0.05] as [number, number, number], center: [0, 1.045, 0] as [number, number, number] };

/** Bryła kolizji skrzydła drzwi budynku w stanie zamkniętym (lokalne współrzędne modelu) — z `SHELLS`. */
export function shellLeafLocal(type: string): { size: [number, number, number]; center: [number, number, number] } | null {
  const spec = SHELLS[type];
  if (!spec?.door) return null;
  const d = spec.door;
  return { size: [d.w - 0.02, d.h - 0.02, 0.05], center: [d.x, spec.floorY + d.h / 2, d.z] };
}

/**
 * Drzwi budynków w lokalnych współrzędnych modelu:
 * `local` to sama framuga, `outside` to miejsce, w którym staje gracz po wyjściu.
 */
export const DOORS: Record<string, { local: [number, number, number]; outside: [number, number, number] }> = {
  palace: { local: [0, 0.44, 2.74], outside: [0, 0, 4.9] },
  library: { local: [0, 0.24, 2.74], outside: [0, 0, 4.8] },
  temple: { local: [0, 0.36, 2.0], outside: [0, 0, 3.6] },
  tower: { local: [0, 0.3, 2.05], outside: [0, 0, 3.8] },
  house: { local: [-1.2, 0.16, 2.48], outside: [-1.2, 0, 4.0] },
};
DOORS.block = DOORS.house;

/** Punkt zaczepienia emitera cząsteczek w lokalnych współrzędnych modelu. */
/** Punkt, w którym staje gracz wchodząc przez bramę (lokalnie, przed bramą). */
export const GATE_SPAWN: [number, number, number] = [0, 0, 1.8];

/**
 * Siodło (oczy jeźdźca) i miejsce, w którym staje po zsiadnięciu — w lokalnych współrzędnych modelu, a gdy
 * podano `seatPart`, w układzie tej ruchomej części (siodło czerwia unosi się razem z głową). `seatBone` to kość
 * modelu z pliku: siodło leży `seat` nad jej bieżącym położeniem, więc jeździec kołysze się z animacją.
 * Samolot: fotel w kokpicie, wysiadka obok kadłuba za skrzydłem.
 */
export const MOUNT_ANCHORS: Record<MountId, { seat: [number, number, number]; exit: [number, number, number]; seatPart?: string; seatBone?: string }> = {
  plane: { seat: [0, 1.66, 0.16], exit: [-1.9, 0, 1.4] },
  hovercar: { seat: [0, 2.28, 0.25], exit: [2.0, 0, 0.2] },
  dragon: { seat: [0, 3.15, 0.3], exit: [2.4, 0, 0.5] },
  sandworm: { seat: [0, 2.35, -0.5], exit: [3.4, 0, 1.0], seatPart: 'head' },
  horse: { seat: [0, 0.85, -0.2], exit: [1.0, 0, 0.3], seatBone: 'Torso' },
};

/**
 * Czasza spadochronu nad graczem: półkula z klinami na przemian w dwóch kolorach i linki do ramion.
 * Zaczepiona w rigu (punkt między stopami), więc obraca się z graczem; skalę 0 → 1 nadaje otwarcie.
 * Materiały są własne, nie z cache `mat` — kliny idą przez kolory wierzchołków, a zwalnia je scena.
 */
export function buildParachute(): THREE.Group {
  const g = new THREE.Group();
  const R = 3.0;
  const top = 6.0; // szczyt czaszy nad stopami; obrzeże wypada 1,4 m nad oczami, linki mają gdzie zbiec
  // bez indeksów: sąsiednie kliny nie dzielą wierzchołków, więc kolor jest ostry, a nie rozmyty w gradient
  const canopy = new THREE.SphereGeometry(R, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  const pos = canopy.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color('#d9573b');
  const b = new THREE.Color('#f4efe4');
  for (let i = 0; i < pos.count; i += 3) {
    // klin po kącie środka trójkąta wokół osi; parzyste ciemne, nieparzyste jasne
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const ang = Math.atan2(cx, cz) + Math.PI;
    const wedge = Math.floor((ang / (Math.PI * 2)) * 16) % 2 === 0 ? a : b;
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = wedge.r;
      colors[(i + v) * 3 + 1] = wedge.g;
      colors[(i + v) * 3 + 2] = wedge.b;
    }
  }
  canopy.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const canopyMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, flatShading: true });
  const canopyMesh = new THREE.Mesh(canopy, canopyMat);
  canopyMesh.position.y = top - R;
  canopyMesh.castShadow = true;
  g.add(canopyMesh);
  // linki: od obrzeża czaszy do ramion
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    pts.push(Math.cos(ang) * R * 0.98, top - R + 0.1, Math.sin(ang) * R * 0.98, Math.cos(ang) * 0.22, 1.35, Math.sin(ang) * 0.22);
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: '#e6e0d2' })));
  return g;
}

export const EMITTER_ANCHORS: Record<string, [number, number, number]> = {
  volcano: [0, 3.7, 0],
  waterfall: [0, 0.35, 0.6],
  campfire: [0, 0.7, 0],
  dragon: [0, 1.95, -4.35], // pysk smoka wierzchowego (ciało ×1,5)
  sandworm: [0, 0.4, 0.5],
};

export function buildModel(type: string, ctx?: Partial<BuildCtx>): THREE.Group {
  const g = new THREE.Group();
  palette = paletteOf(ctx?.colors);
  usedRoles = new Set();
  (BUILDERS[type] ?? buildObelisk)(g, { ...ctx, floorHeight: ctx?.floorHeight ?? 3.2 });
  g.userData.roles = [...usedRoles];
  palette = MATERIAL_DEFAULTS;
  return g;
}

const rolesCache = new Map<string, MaterialRole[]>();
/** Warstwy materiałów, których używa model danego typu (z próbnej budowy; wynik jest zapamiętany). */
export function rolesOf(type: string): MaterialRole[] {
  let roles = rolesCache.get(type);
  if (!roles) {
    const g = buildModel(type, { floorHeight: 3.2, floors: 2 });
    roles = (g.userData.roles as MaterialRole[]).filter((r) => r !== 'glow');
    disposeObject(g);
    rolesCache.set(type, roles);
  }
  return roles;
}

/** Wysokość modelu (do pozycjonowania etykiet). */
/** Ramka modelu w jego układzie (bez skórowanych siatek — ich ramka leży w układzie kości, setki metrów). */
export function modelBounds(g: THREE.Object3D): THREE.Box3 {
  const b = new THREE.Box3();
  g.updateWorldMatrix(true, true);
  g.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    b.expandByObject(m);
  });
  return b;
}

export function modelHeight(g: THREE.Object3D): number {
  const b = modelBounds(g);
  return Number.isFinite(b.max.y) ? b.max.y : 1;
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    // klony modelu z pliku dzielą geometrię z cache — zwalnia się z nimi tylko szkielet
    if (m.userData.sharedGeometry) {
      if ((m as unknown as THREE.SkinnedMesh).isSkinnedMesh) (m as unknown as THREE.SkinnedMesh).skeleton.dispose();
      return;
    }
    if (m.geometry) m.geometry.dispose();
    // materiały są współdzielone (cache) — nie usuwamy; wyjątek: własne klony (szyba okna)
    if (m.userData.ownMaterial && m.material) (m.material as THREE.Material).dispose();
    // ciało smoka wierzchowego ma własne materiały (spoza cache) zebrane na korzeniu modelu
    const own = c.userData.ownMaterials as THREE.Material[] | undefined;
    if (own) for (const mm of own) mm.dispose();
  });
}
