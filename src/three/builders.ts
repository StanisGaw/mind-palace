import * as THREE from 'three';
import { buildAnimalBody, type AnimalKind } from './wildlife';
import { DOOR_OPENING, FACADE, SHELLS, SHELL_WALL_T, TOWER_R, WALL_SEGMENT, WALL_THICKNESS, facadeWallsOf, shellWindowHoles, type FacadeWall, type Opening, type ShellSpec, type WallHole } from '../lib/rooms';
import { subtractRect, type Rect } from './interior';
import { paintingTexture } from './art';
import { grainTexture, textureById } from './textures';
import { MATERIAL_DEFAULTS, MATERIAL_ROLES, paletteOf, type MaterialRole } from '../lib/materials';

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

/** Wykończenie powierzchni: tekstura o id `id` (wbudowana albo własna) albo sam kolor, gdy jej brak. */
export function finishMat(id: string | undefined, color: string, opts: MatOpts = {}) {
  const tex = textureById(id);
  return tex ? mat('#ffffff', { ...opts, flat: false, map: tex }) : mat(color, opts);
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

function add(group: THREE.Group, geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, rot?: [number, number, number]) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
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

/** Prostokąty przybliżające koło o promieniu `r` (ośmiokąt z pięciu nienachodzących pasów) — stropy okrągłych wnętrz. */
export function discRects(r: number, cx = 0, cz = 0): Rect[] {
  const a = 0.7 * r;
  const b = 0.97 * r;
  const s = 0.3 * r;
  return [
    { x0: cx - a, x1: cx + a, z0: cz - a, z1: cz + a },
    { x0: cx + a, x1: cx + b, z0: cz - s, z1: cz + s },
    { x0: cx - b, x1: cx - a, z0: cz - s, z1: cz + s },
    { x0: cx - s, x1: cx + s, z0: cz + a, z1: cz + b },
    { x0: cx - s, x1: cx + s, z0: cz - b, z1: cz - a },
  ];
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
}

/**
 * Kręcone schody wzdłuż muru: widoczne stopnie bez kolizji i niewidoczne pochylnie (jedyna bryła),
 * jak schody z Konstrukcji. Zwraca prostokąt otworu w stropie nad ostatnią ćwiartką i pochylnie
 * (do kolizji pokoju, gdy schody nie są częścią modelu obiektu).
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
 * Zwraca prostokąt otworu w stropie nad częścią schodów, gdzie prześwit spada poniżej 2,3 m.
 */
export function spiralStairs(g: THREE.Group, spec: SpiralSpec, stepMat: THREE.Material): { hole: Rect; ribbon: Trimesh } {
  const rise = spec.height / spec.steps;
  const rm = (spec.r + spec.inner) / 2;
  const da = spec.turn / spec.steps;
  const run = rm * da;
  const width = spec.r - spec.inner;
  const hole = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  const holeFrom = Math.max(0.1, 1 - 2.3 / spec.height);
  for (let i = 0; i < spec.steps; i++) {
    const a = spec.start + da * (i + 0.5);
    const x = spec.cx + Math.sin(a) * rm;
    const z = spec.cz + Math.cos(a) * rm;
    const y = spec.y0 + rise * (i + 0.5);
    // lokalna oś X to styczna (kierunek wznoszenia), lokalna Z to promień
    const step = add(g, box(run + 0.02, rise, width), stepMat, x, y, z, [0, a, 0]);
    step.userData.skipCollider = true;
    if (i >= spec.steps * holeFrom) {
      for (const rr of [spec.inner, spec.r]) {
        for (const aa of [a - da / 2, a + da / 2]) {
          const px = spec.cx + Math.sin(aa) * rr;
          const pz = spec.cz + Math.cos(aa) * rr;
          hole.x0 = Math.min(hole.x0, px);
          hole.x1 = Math.max(hole.x1, px);
          hole.z0 = Math.min(hole.z0, pz);
          hole.z1 = Math.max(hole.z1, pz);
        }
      }
    }
  }
  const ribbon = helixRibbon(spec, rise);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(ribbon.vertices, 3));
  geo.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, stepMat);
  mesh.visible = false;
  g.add(mesh);
  return { hole: { x0: hole.x0 - 0.05, x1: hole.x1 + 0.05, z0: hole.z0 - 0.05, z1: hole.z1 + 0.05 }, ribbon };
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
  if (lining) shellLining(g, wallGeometry(x0, x1, y0, y1, holes, LINING_T), lining, 0, z - normal[1] * (SHELL_WALL_T / 2 + LINING_T / 2 + 0.002), 0, normal);
  return mesh;
}

const LINING_T = 0.01;
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
  if (lining) shellLining(g, wallGeometry(z0, z1, y0, y1, holes, LINING_T), lining, x - normal[0] * (SHELL_WALL_T / 2 + LINING_T / 2 + 0.002), 0, -Math.PI / 2, normal);
  return mesh;
}

/** Stropy między kondygnacjami budynku: pudełka omijające otwory nad schodami; po nich też stawia się obiekty. */
function shellSlabs(g: THREE.Group, ctx: BuildCtx, base: Rect[], floorY: number, H: number, m: THREE.Material, extraHoles: Rect[][] = []) {
  const floors = Math.max(1, ctx.floors ?? 1);
  for (let k = 1; k < floors; k++) {
    let rects: Rect[] = base.map((r) => ({ ...r }));
    for (const op of ctx.slabOpenings?.[k - 1] ?? []) rects = subtractRect(rects, { x0: op.cx - op.hx, x1: op.cx + op.hx, z0: op.cz - op.hz, z1: op.cz + op.hz });
    for (const hole of extraHoles[k - 1] ?? []) rects = subtractRect(rects, hole);
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
  const t = SHELL_WALL_T / 2;
  const f = shellWindows(g, ctx, type);
  const floorFinish = ctx.finish?.floor ? finishMat(ctx.finish.floor, C.stone) : floorMat;
  const lining = ctx.finish?.wall ? finishMat(ctx.finish.wall, C.cream) : undefined;
  shellFloor(g, w, d, spec.cx, y0, spec.cz, floorFinish);
  const doorHole: WallHole[] = spec.door ? [{ u0: spec.door.x - spec.door.w / 2, u1: spec.door.x + spec.door.w / 2, v0: y0 - 0.02, v1: y0 + spec.door.h }] : [];
  shellWallX(g, x0 - t, x1 + t, y0 - 0.01, y1, z0 - t, wallMat, [0, -1], f.back ?? [], lining); // tylna
  shellWallX(g, x0 - t, x1 + t, y0 - 0.01, y1, z1 + t, wallMat, [0, 1], [...doorHole, ...(f.front ?? [])], lining); // przednia
  shellWallZ(g, z0, z1, y0 - 0.01, y1, x0 - t, wallMat, [-1, 0], f.left ?? [], lining);
  shellWallZ(g, z0, z1, y0 - 0.01, y1, x1 + t, wallMat, [1, 0], f.right ?? [], lining);
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

function buildPalace(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.palace;
  add(g, box(4.6, 0.28, 3.6), mat(C.stone), 0, 0.14, 0);
  add(g, box(4.0, 0.16, 3.0), mat(C.cream2), 0, 0.36, 0);
  shellBox(g, ctx, 'palace', mat(C.cream), mat(C.stone), mat(C.dark));
  shellEntryRamp(g, spec, 2.3);
  // portyk
  columns(g, [[-1.15, 1.0], [-0.4, 1.0], [0.4, 1.0], [1.15, 1.0]], 1.7, 0.11, 0.44);
  add(g, box(3.2, 0.22, 0.9), mat(C.cream2), 0, 0.44 + 1.7 + 0.11, 0.75);
  const roof = roofGroup(g, roofLift(ctx, spec));
  add(roof, prism(3.4, 0.6, 0.95), mat(C.cream), 0, 0.44 + 1.92, 0.75);
  add(roof, box(3.46, 0.08, 2.46), mat(C.cream2), 0, 2.34 + 0.04, -0.2); // strop nad salą
  // bęben + kopuła
  add(roof, cyl(1.05, 1.05, 0.45, 16), mat(C.cream2), 0, 0.44 + 1.9 + 0.22, -0.2);
  add(roof, cyl(1.15, 1.15, 0.1, 16), mat(C.stone), 0, 0.44 + 1.9 + 0.5, -0.2);
  const dome = new THREE.SphereGeometry(1.05, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  add(roof, dome, mat(C.dome, { flat: false }), 0, 0.44 + 1.9 + 0.55, -0.2);
  add(roof, sphere(0.12, 8), mat(C.domeDark), 0, 0.44 + 1.9 + 0.55 + 1.08, -0.2);
  // schody
  add(g, box(2.2, 0.12, 0.5), mat(C.stone), 0, 0.06, 1.95);
  add(g, box(2.2, 0.12, 0.3), mat(C.stoneDark), 0, 0.18, 1.85);
}

function buildLibrary(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.library;
  add(g, box(4.0, 0.24, 3.2), mat(C.stone), 0, 0.12, 0);
  shellBox(g, ctx, 'library', mat(C.cream), mat(C.stone), mat(C.dark));
  shellEntryRamp(g, spec, 2.3);
  columns(g, [[-1.2, 0.95], [-0.4, 0.95], [0.4, 0.95], [1.2, 0.95]], 1.6, 0.1, 0.24);
  add(g, box(3.4, 0.18, 1.1), mat(C.cream2), 0, 0.24 + 1.6 + 0.09, 0.55);
  const roof = roofGroup(g, roofLift(ctx, spec));
  add(roof, box(3.26, 0.1, 2.46), mat(C.cream2), 0, 1.94 + 0.05, -0.2); // strop
  add(roof, prism(3.6, 0.8, 3.1), mat(C.roof), 0, 0.24 + 1.78, -0.05);
  add(g, box(0.9, 0.16, 0.14), mat(C.roofDark), 0, 0.24 + 1.35, 1.07);
  add(g, box(1.6, 0.1, 0.6), mat(C.stone), 0, 0.05, 1.85);
}

function buildTemple(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.temple;
  add(g, box(2.8, 0.22, 2.4), mat(C.stone), 0, 0.11, 0);
  add(g, box(2.4, 0.14, 2.0), mat(C.cream2), 0, 0.29, 0);
  const templeFloor = finishMat(ctx.finish?.floor, C.cream2);
  shellFloor(g, spec.inner.w, spec.inner.d, 0, spec.floorY, 0, templeFloor);
  shellSlabs(g, ctx, [{ x0: -spec.inner.w / 2, x1: spec.inner.w / 2, z0: -spec.inner.d / 2, z1: spec.inner.d / 2 }], spec.floorY, spec.inner.h, templeFloor);
  shellRamp(g, 0, 1.6, 1.0, 2.0, spec.floorY); // wejście między kolumnami od frontu
  columns(g, [[-0.9, 0.7], [0.9, 0.7], [-0.9, -0.7], [0.9, -0.7]], 1.5, 0.1, 0.36);
  const roof = roofGroup(g, roofLift(ctx, spec));
  add(roof, box(2.4, 0.16, 2.0), mat(C.cream), 0, 0.36 + 1.5 + 0.08, 0);
  add(roof, prism(2.6, 0.7, 2.2), mat(C.roof), 0, 0.36 + 1.66, 0);
  add(g, box(0.8, 0.9, 0.8), mat(C.cream2), 0, 0.36 + 0.45, -0.3);
}

function buildTower(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.tower;
  const r = TOWER_R;
  add(g, cyl(r + 0.2, r + 0.3, 0.3, 12), mat(C.stone), 0, 0.15, 0);
  const floorFinish = finishMat(ctx.finish?.floor, C.stone);
  const lining = ctx.finish?.wall ? finishMat(ctx.finish.wall, C.cream) : undefined;
  const floor = add(g, scaleUv(cyl(r - 0.06, r - 0.06, 0.04, 12), 2 * r, 2 * r), floorFinish, 0, spec.floorY - 0.01, 0);
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
    const seg = add(g, wallGeometry(-side / 2 - 0.01, side / 2 + 0.01, spec.floorY - 0.01, top, holes, 0.1), mat(C.cream), x, 0, z, [0, a, 0]);
    seg.userData.wallNormal = [Math.sin(a), Math.cos(a)];
    if (lining) shellLining(g, wallGeometry(-side / 2 - 0.01, side / 2 + 0.01, spec.floorY - 0.01, top, holes, LINING_T), lining, Math.sin(a) * (r - 0.05 - LINING_T / 2 - 0.002), Math.cos(a) * (r - 0.05 - LINING_T / 2 - 0.002), a, [Math.sin(a), Math.cos(a)]);
  }
  shellLeaf(g, door, spec.floorY, mat(C.dark));
  shellEntryRamp(g, spec, r + 0.7);
  // wieża ma wbudowane kręcone schody wzdłuż muru: bez nich piętra byłyby nieosiągalne; bieg 0,5 szerokości
  // zostawia pośrodku wolne koło o promieniu ~1 (2,6 m średnicy przy skali 2,5)
  const holes: Rect[][] = [];
  for (let k = 0; k < floors - 1; k++) {
    const { hole } = spiralStairs(g, { cx: 0, cz: 0, r: r - 0.08, inner: r - 0.58, y0: spec.floorY + k * h, height: h, start: Math.PI / 2, turn: Math.PI * 1.5, steps: Math.max(8, Math.round((h * 2.5) / 0.27)) }, mat(C.stoneDark));
    holes.push([hole]);
  }
  shellSlabs(g, ctx, discRects(r - 0.06), spec.floorY, h, floorFinish, holes);
  const lift = top - 3.9; // gzyms i stożek siedzą na szczycie muru
  const roof = roofGroup(g, lift);
  add(roof, cyl(r + 0.1, r + 0.1, 0.22, 12), mat(C.cream2), 0, 3.9 + 0.11, 0);
  add(roof, cone(r + 0.18, 1.5, 12), mat(C.roof), 0, 4.12 + 0.75, 0);
  add(roof, sphere(0.1), mat(C.domeDark), 0, 5.62, 0);
}

function buildHouse(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.house;
  add(g, box(2.4, 0.16, 2.2), mat(C.stone), 0, 0.08, 0);
  shellBox(g, ctx, 'house', mat(C.cream), woodMat(C.wood), mat(C.dark));
  shellEntryRamp(g, spec, 1.6);
  const roof = roofGroup(g, roofLift(ctx, spec));
  add(roof, prism(2.3, 0.9, 2.1), mat(C.roof), 0, 1.56, 0);
  add(roof, box(0.3, 0.7, 0.3), mat(C.stoneDark), 0.6, 1.9, -0.4);
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

function buildBooks(g: THREE.Group) {
  add(g, box(0.7, 0.14, 0.5), mat(C.book1), 0, 0.07, 0, [0, 0.1, 0]);
  add(g, box(0.62, 0.14, 0.46), mat(C.book2), 0.03, 0.21, 0.02, [0, -0.15, 0]);
  add(g, box(0.66, 0.12, 0.48), mat(C.book3), -0.02, 0.34, -0.02, [0, 0.25, 0]);
  add(g, box(0.5, 0.05, 0.36), mat(C.paper), 0, 0.42, 0, [0, 0.05, 0]);
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
  /** Otwory elewacji (okna, balkony, tarasy) na ścianach powłoki: klucz ściany → otwory w jej układzie (u wzdłuż, v wysokość). */
  facade?: Record<string, WallHole[]>;
  /** Taras: wysokość podłogi parteru nad ziemią (schodki w dół), metry świata. */
  drop?: number;
  /** Obraz: styl płótna (z hasza id obiektu). */
  variant?: number;
  /** Nadpisane kolory warstw (rola → `#rrggbb`). */
  colors?: Record<string, string>;
  /** Wykończenie: tekstura podłogi i ścian wnętrza budynku w miejscu; dla ścieżki `floor` to nawierzchnia. */
  finish?: { floor?: string; wall?: string };
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
  // niewidoczna pochylnia: jedyna bryła kolizji, płynniejsza niż schodkowanie stopni; jej wierzch
  // przechodzi przez wierzchy stopni, żeby postać nie płynęła przez ich krawędzie
  const rampLen = Math.hypot(len, H);
  const ramp = add(g, box(width + 0.1, 0.15, rampLen), mat(C.stone), 0, H / 2 + rise / 2 + 0.02 - 0.075, 0, [-Math.atan2(H, len), 0, 0]);
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

function buildShelf(g: THREE.Group) {
  add(g, box(1.4, 2.2, 0.36), woodMat(C.woodDark), 0, 1.1, -0.02);
  add(g, box(1.3, 2.05, 0.06), woodMat(C.wood), 0, 1.1, 0.14);
  const cols = [C.book1, C.book2, C.book3, C.flower3];
  for (let shelf = 0; shelf < 4; shelf++) {
    const y = 0.35 + shelf * 0.5;
    add(g, box(1.28, 0.05, 0.32), woodMat(C.wood), 0, y, 0);
    for (let i = 0; i < 7; i++) {
      const h = 0.28 + ((i * 7 + shelf * 3) % 5) * 0.02;
      add(g, box(0.13, h, 0.24), mat(cols[(i + shelf) % 4]), -0.53 + i * 0.17, y + h / 2 + 0.03, 0);
    }
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

const BUILDERS: Record<string, (g: THREE.Group, ctx: BuildCtx) => void> = {
  wall: buildWall,
  pathway: buildPath,
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
  palace: { local: [0, 0.44, 1.0], outside: [0, 0, 3.1] },
  library: { local: [0, 0.24, 1.0], outside: [0, 0, 3.0] },
  temple: { local: [0, 0.36, 0.9], outside: [0, 0, 2.6] },
  tower: { local: [0, 0.3, 1.05], outside: [0, 0, 2.8] },
  house: { local: [-0.4, 0.16, 0.92], outside: [-0.4, 0, 2.4] },
};

/** Punkt zaczepienia emitera cząsteczek w lokalnych współrzędnych modelu. */
/** Punkt, w którym staje gracz wchodząc przez bramę (lokalnie, przed bramą). */
export const GATE_SPAWN: [number, number, number] = [0, 0, 1.8];

export const EMITTER_ANCHORS: Record<string, [number, number, number]> = {
  volcano: [0, 3.7, 0],
  waterfall: [0, 0.35, 0.6],
  campfire: [0, 0.7, 0],
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
export function modelHeight(g: THREE.Object3D): number {
  const b = new THREE.Box3().setFromObject(g);
  return Number.isFinite(b.max.y) ? b.max.y : 1;
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    // materiały są współdzielone (cache) — nie usuwamy; wyjątek: własne klony (szyba okna)
    if (m.userData.ownMaterial && m.material) (m.material as THREE.Material).dispose();
  });
}
