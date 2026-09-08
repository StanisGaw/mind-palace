import * as THREE from 'three';
import { buildAnimalBody, type AnimalKind } from './wildlife';
import { DOOR_OPENING, SHELLS, WALL_SEGMENT, WALL_THICKNESS, type Opening, type ShellSpec } from '../lib/rooms';
import { subtractRect, type Rect } from './interior';

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: { emissive?: string; roughness?: number; metalness?: number; flat?: boolean } = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.roughness ?? 0.85}|${opts.metalness ?? 0}|${opts.flat ?? true}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0,
      flatShading: opts.flat ?? true,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    });
    matCache.set(key, m);
  }
  return m;
}

const C = {
  cream: '#f3efe6',
  cream2: '#e8e2d5',
  stone: '#d9d4c7',
  stoneDark: '#b8b2a3',
  dome: '#9db6b0',
  domeDark: '#86a39c',
  roof: '#d9a689',
  roofDark: '#c58f72',
  wood: '#b98a5c',
  woodDark: '#8b6a4f',
  leaf: '#8fae7c',
  leaf2: '#7ea06d',
  leafDark: '#5e8a5f',
  cypress: '#4f7c5c',
  cypress2: '#5f8c68',
  water: '#a9d3e6',
  metal: '#4a4f4a',
  glow: '#ffe7a3',
  dark: '#3b3f3a',
  paper: '#f7f2e5',
  book1: '#c9705f',
  book2: '#6b8fb3',
  book3: '#d9b45a',
  flower1: '#e88a8a',
  flower2: '#f0c36b',
  flower3: '#c9a2d8',
  soil: '#8d7358',
  rock: '#8f8b82',
  rockDark: '#75726b',
  rockLight: '#a5a096',
  snow: '#f2f4f3',
  volcano: '#5e5852',
  volcanoDark: '#463f3b',
  lava: '#ff6a3d',
};

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

const SHELL_WALL_T = 0.06;

/** Oznacza wszystko w grupie jako dach — chowany w edytorze, gdy budynek jest aktywny. */
function roofGroup(g: THREE.Group): THREE.Group {
  const r = new THREE.Group();
  r.userData.roof = true;
  g.add(r);
  return r;
}

/** Podłoga wnętrza: cienka płyta z flagą, po której stawia się obiekty. Wierzch 1 cm nad cokołem — wspólna płaszczyzna migotałaby. */
function shellFloor(g: THREE.Group, w: number, d: number, x: number, y: number, z: number, material: THREE.Material) {
  const f = add(g, box(w, 0.04, d), material, x, y - 0.01, z);
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
  const holeFrom = Math.max(0.3, 1 - 2.3 / spec.height);
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
function shellWallPiece(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, normal: [number, number]) {
  const mesh = add(g, geo, m, x, y, z);
  mesh.userData.wallNormal = normal;
  return mesh;
}

/** Ściana wzdłuż X (na `z`) z ewentualnym otworem na drzwi: słupki i nadproże, jak w ściance działowej. */
function shellWallX(g: THREE.Group, x0: number, x1: number, y0: number, y1: number, z: number, m: THREE.Material, normal: [number, number], door?: { x: number; w: number; h: number }) {
  const h = y1 - y0;
  if (!door) {
    shellWallPiece(g, box(x1 - x0, h, SHELL_WALL_T), m, (x0 + x1) / 2, y0 + h / 2, z, normal);
    return;
  }
  const a = door.x - door.w / 2;
  const b = door.x + door.w / 2;
  if (a - x0 > 1e-3) shellWallPiece(g, box(a - x0, h, SHELL_WALL_T), m, (x0 + a) / 2, y0 + h / 2, z, normal);
  if (x1 - b > 1e-3) shellWallPiece(g, box(x1 - b, h, SHELL_WALL_T), m, (b + x1) / 2, y0 + h / 2, z, normal);
  const lh = h - door.h;
  if (lh > 1e-3) shellWallPiece(g, box(b - a + 0.02, lh, SHELL_WALL_T - 0.004), m, door.x, y0 + door.h + lh / 2, z, normal);
}

/** Ściana wzdłuż Z (na `x`). */
function shellWallZ(g: THREE.Group, z0: number, z1: number, y0: number, y1: number, x: number, m: THREE.Material, normal: [number, number]) {
  const h = y1 - y0;
  shellWallPiece(g, box(SHELL_WALL_T, h, z1 - z0), m, x, y0 + h / 2, (z0 + z1) / 2, normal);
}

/** Stropy między kondygnacjami budynku: pudełka omijające otwory nad schodami; po nich też stawia się obiekty. */
function shellSlabs(g: THREE.Group, ctx: BuildCtx, base: Rect[], floorY: number, innerH: number, m: THREE.Material, extraHoles: Rect[][] = []) {
  const floors = Math.max(1, ctx.floors ?? 1);
  const H = innerH / floors;
  for (let k = 1; k < floors; k++) {
    let rects: Rect[] = base.map((r) => ({ ...r }));
    for (const op of ctx.slabOpenings?.[k - 1] ?? []) rects = subtractRect(rects, { x0: op.cx - op.hx, x1: op.cx + op.hx, z0: op.cz - op.hz, z1: op.cz + op.hz });
    for (const hole of extraHoles[k - 1] ?? []) rects = subtractRect(rects, hole);
    for (const r of rects) {
      if (r.x1 - r.x0 < 0.01 || r.z1 - r.z0 < 0.01) continue;
      const slab = add(g, box(r.x1 - r.x0, 0.04, r.z1 - r.z0), m, (r.x0 + r.x1) / 2, floorY + k * H - 0.02, (r.z0 + r.z1) / 2);
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
function shellBox(g: THREE.Group, ctx: BuildCtx, spec: ShellSpec, wallMat: THREE.Material, floorMat: THREE.Material, leafMat: THREE.Material) {
  const { w, d, h } = spec.inner;
  const x0 = spec.cx - w / 2;
  const x1 = spec.cx + w / 2;
  const z0 = spec.cz - d / 2;
  const z1 = spec.cz + d / 2;
  const y0 = spec.floorY;
  const y1 = spec.floorY + h;
  const t = SHELL_WALL_T / 2;
  shellFloor(g, w, d, spec.cx, y0, spec.cz, floorMat);
  shellWallX(g, x0 - t, x1 + t, y0 - 0.01, y1, z0 - t, wallMat, [0, -1]); // tylna
  shellWallX(g, x0 - t, x1 + t, y0 - 0.01, y1, z1 + t, wallMat, [0, 1], spec.door); // przednia
  shellWallZ(g, z0, z1, y0 - 0.01, y1, x0 - t, wallMat, [-1, 0]);
  shellWallZ(g, z0, z1, y0 - 0.01, y1, x1 + t, wallMat, [1, 0]);
  if (spec.door) shellLeaf(g, spec.door, y0, leafMat);
  shellSlabs(g, ctx, [{ x0, x1, z0, z1 }], y0, h, floorMat);
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
  shellBox(g, ctx, spec, mat(C.cream), mat(C.stone), mat(C.dark));
  shellEntryRamp(g, spec, 2.3);
  // portyk
  columns(g, [[-1.15, 1.0], [-0.4, 1.0], [0.4, 1.0], [1.15, 1.0]], 1.7, 0.11, 0.44);
  add(g, box(3.2, 0.22, 0.9), mat(C.cream2), 0, 0.44 + 1.7 + 0.11, 0.75);
  add(g, box(0.36, 0.5, 0.05), mat(C.domeDark), -1.05, 0.44 + 1.1, 1.04);
  add(g, box(0.36, 0.5, 0.05), mat(C.domeDark), 1.05, 0.44 + 1.1, 1.04);
  const roof = roofGroup(g);
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
  shellBox(g, ctx, spec, mat(C.cream), mat(C.stone), mat(C.dark));
  shellEntryRamp(g, spec, 2.3);
  columns(g, [[-1.2, 0.95], [-0.4, 0.95], [0.4, 0.95], [1.2, 0.95]], 1.6, 0.1, 0.24);
  add(g, box(3.4, 0.18, 1.1), mat(C.cream2), 0, 0.24 + 1.6 + 0.09, 0.55);
  const roof = roofGroup(g);
  add(roof, box(3.26, 0.1, 2.46), mat(C.cream2), 0, 1.94 + 0.05, -0.2); // strop
  add(roof, prism(3.6, 0.8, 3.1), mat(C.roof), 0, 0.24 + 1.78, -0.05);
  add(g, box(0.9, 0.16, 0.14), mat(C.roofDark), 0, 0.24 + 1.35, 1.07);
  for (const x of [-1.0, 1.0]) add(g, box(0.34, 0.45, 0.05), mat(C.domeDark), x, 0.24 + 1.0, 1.04);
  add(g, box(1.6, 0.1, 0.6), mat(C.stone), 0, 0.05, 1.85);
}

function buildTemple(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.temple;
  add(g, box(2.8, 0.22, 2.4), mat(C.stone), 0, 0.11, 0);
  add(g, box(2.4, 0.14, 2.0), mat(C.cream2), 0, 0.29, 0);
  shellFloor(g, spec.inner.w, spec.inner.d, 0, spec.floorY, 0, mat(C.cream2));
  shellSlabs(g, ctx, [{ x0: -spec.inner.w / 2, x1: spec.inner.w / 2, z0: -spec.inner.d / 2, z1: spec.inner.d / 2 }], spec.floorY, spec.inner.h, mat(C.cream2));
  shellRamp(g, 0, 1.6, 1.0, 2.0, spec.floorY); // wejście między kolumnami od frontu
  columns(g, [[-0.9, 0.7], [0.9, 0.7], [-0.9, -0.7], [0.9, -0.7]], 1.5, 0.1, 0.36);
  const roof = roofGroup(g);
  add(roof, box(2.4, 0.16, 2.0), mat(C.cream), 0, 0.36 + 1.5 + 0.08, 0);
  add(roof, prism(2.6, 0.7, 2.2), mat(C.roof), 0, 0.36 + 1.66, 0);
  add(g, box(0.8, 0.9, 0.8), mat(C.cream2), 0, 0.36 + 0.45, -0.3);
}

function buildTower(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.tower;
  add(g, cyl(1.0, 1.1, 0.3, 12), mat(C.stone), 0, 0.15, 0);
  const floor = add(g, cyl(0.72, 0.72, 0.04, 12), mat(C.stone), 0, spec.floorY - 0.01, 0);
  floor.userData.floorSurface = true;
  // mur z dwunastu segmentów — przedni to tylko nadproże nad drzwiami
  const r = 0.8;
  const side = 2 * r * Math.tan(Math.PI / 12);
  const h = spec.inner.h;
  const door = spec.door!;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (i === 0) {
      const lh = h - door.h;
      add(g, box(side + 0.02, lh, 0.1), mat(C.cream), x, spec.floorY + door.h + lh / 2, z, [0, a, 0]);
      continue;
    }
    const seg = add(g, box(side + 0.02, h + 0.01, 0.1), mat(C.cream), x, spec.floorY + h / 2 - 0.005, z, [0, a, 0]);
    seg.userData.wallNormal = [Math.sin(a), Math.cos(a)];
  }
  shellLeaf(g, door, spec.floorY, mat(C.dark));
  shellEntryRamp(g, spec, 1.5);
  // wieża ma wbudowane kręcone schody wzdłuż muru: bez nich piętra byłyby nieosiągalne
  const floors = Math.max(1, ctx.floors ?? 1);
  const holes: Rect[][] = [];
  for (let k = 0; k < floors - 1; k++) {
    const H = h / floors;
    const { hole } = spiralStairs(g, { cx: 0, cz: 0, r: 0.72, inner: 0.26, y0: spec.floorY + k * H, height: H, start: Math.PI / 2, turn: Math.PI * 1.5, steps: Math.max(8, Math.round((H * 2) / 0.22)) }, mat(C.stoneDark));
    holes.push([hole]);
  }
  shellSlabs(g, ctx, discRects(0.74), spec.floorY, h, mat(C.stone), holes);
  const roof = roofGroup(g);
  add(roof, cyl(0.9, 0.9, 0.22, 12), mat(C.cream2), 0, 3.9 + 0.11, 0);
  add(roof, cone(0.98, 1.4, 12), mat(C.roof), 0, 4.12 + 0.7, 0);
  add(roof, sphere(0.1), mat(C.domeDark), 0, 5.55, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    add(g, box(0.22, 0.5, 0.06), mat(C.domeDark), Math.sin(a) * 0.86, 2.6, Math.cos(a) * 0.86, [0, a, 0]);
  }
}

function buildHouse(g: THREE.Group, ctx: BuildCtx) {
  const spec = SHELLS.house;
  add(g, box(2.4, 0.16, 2.2), mat(C.stone), 0, 0.08, 0);
  shellBox(g, ctx, spec, mat(C.cream), mat(C.wood), mat(C.dark));
  shellEntryRamp(g, spec, 1.6);
  const roof = roofGroup(g);
  add(roof, prism(2.3, 0.9, 2.1), mat(C.roof), 0, 1.56, 0);
  add(roof, box(0.3, 0.7, 0.3), mat(C.stoneDark), 0.6, 1.9, -0.4);
  add(g, box(0.4, 0.4, 0.05), mat(C.domeDark), 0.5, 0.16 + 0.85, 0.95);
}

function buildGazebo(g: THREE.Group) {
  add(g, cyl(1.5, 1.6, 0.2, 6), mat(C.stone), 0, 0.1, 0);
  add(g, cyl(1.3, 1.3, 0.1, 6), mat(C.cream2), 0, 0.25, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    add(g, cyl(0.07, 0.07, 1.8, 8), mat(C.wood), Math.cos(a) * 1.15, 0.3 + 0.9, Math.sin(a) * 1.15);
  }
  add(g, cyl(1.45, 1.45, 0.12, 6), mat(C.woodDark), 0, 2.16, 0);
  add(g, cone(1.6, 0.9, 6), mat(C.roof), 0, 2.22 + 0.45, 0);
  add(g, box(0.7, 0.45, 0.7), mat(C.wood), 0, 0.3 + 0.22, 0);
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
  add(g, box(1.4, 0.08, 0.45), mat(C.wood), 0, 0.45, 0);
  add(g, box(1.4, 0.4, 0.07), mat(C.wood), 0, 0.72, -0.2, [-0.15, 0, 0]);
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
  add(g, box(0.9, 0.5, 0.6), mat(C.wood), 0, 0.25, 0);
  const lid = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10, 1, false, 0, Math.PI);
  add(g, lid, mat(C.woodDark), 0, 0.5, 0, [0, 0, Math.PI / 2]);
  add(g, box(0.92, 0.06, 0.62), mat(C.metal), 0, 0.5, 0);
  add(g, box(0.12, 0.16, 0.06), mat(C.metal), 0, 0.42, 0.31);
}

function buildSignpost(g: THREE.Group) {
  add(g, cyl(0.05, 0.06, 2.0, 8), mat(C.woodDark), 0, 1.0, 0);
  add(g, box(0.9, 0.22, 0.06), mat(C.wood), 0.3, 1.7, 0, [0, 0.4, 0]);
  add(g, box(0.8, 0.22, 0.06), mat(C.wood), -0.25, 1.4, 0, [0, -0.6, 0]);
  add(g, box(0.16, 0.16, 0.16), mat(C.stone), 0, 0.08, 0);
}

function buildWell(g: THREE.Group) {
  add(g, cyl(0.7, 0.75, 0.7, 12), mat(C.stoneDark), 0, 0.35, 0);
  add(g, cyl(0.5, 0.5, 0.05, 12), mat(C.water, { flat: false, roughness: 0.3 }), 0, 0.7, 0);
  for (const x of [-0.6, 0.6]) add(g, box(0.1, 1.5, 0.1), mat(C.wood), x, 0.75 + 0.7, 0);
  add(g, prism(1.7, 0.5, 1.2), mat(C.roof), 0, 2.15, 0);
  add(g, cyl(0.04, 0.04, 1.3, 6), mat(C.woodDark), 0, 1.75, 0, [0, 0, Math.PI / 2]);
  add(g, cyl(0.16, 0.16, 0.24, 8), mat(C.woodDark), 0, 1.75, 0, [0, 0, Math.PI / 2]);
}

function buildTree(g: THREE.Group) {
  add(g, cyl(0.12, 0.18, 1.2, 8), mat(C.woodDark), 0, 0.6, 0);
  add(g, dodeca(0.85, 0), mat(C.leaf), 0, 1.75, 0);
  add(g, dodeca(0.6, 0), mat(C.leaf2), 0.45, 2.1, 0.2);
  add(g, dodeca(0.55, 0), mat(C.leafDark), -0.45, 1.5, -0.25);
  add(g, dodeca(0.5, 0), mat(C.leaf), 0.1, 2.35, -0.4);
}

function buildCypress(g: THREE.Group) {
  add(g, cyl(0.08, 0.12, 0.5, 8), mat(C.woodDark), 0, 0.25, 0);
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
    add(g, cyl(0.1 - i * 0.008, 0.13 - i * 0.008, 0.6, 7), mat(C.woodDark), i * 0.08, 0.3 + i * 0.55, 0, [0, 0, -0.12]);
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
    const wing = add(g, box(1.25, 2.3, 0.08), mat(C.woodDark), s2 * 1.28, 1.2, 0.1);
    wing.rotation.y = s2 * 0.55;
    wing.position.x = s2 * 0.95;
    wing.position.z = 0.35 * 1;
    for (let i = 0; i < 3; i++) {
      const bar = add(g, box(1.1, 0.09, 0.11), mat(C.wood), 0, 0.5 + i * 0.8, 0);
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
  add(g, cyl(0.04, 0.05, 1.5, 6), mat(C.woodDark), 0, 0.75, 0);
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
  add(g, cyl(0.06, 0.07, 0.9, 5), mat(C.woodDark), 0, 0.14, 0, [0, 0.4, 1.2]);
  add(g, cyl(0.06, 0.07, 0.9, 5), mat(C.woodDark), 0, 0.14, 0, [0, 2.5, 1.2]);
  add(g, cyl(0.06, 0.07, 0.9, 5), mat(C.woodDark), 0, 0.14, 0, [0, 4.6, 1.2]);
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
  /** Środki otworów drzwiowych wzdłuż ścianki, w metrach świata od jej środka. */
  openings?: number[];
  /** Budynek z wnętrzem w miejscu: liczba kondygnacji i otwory w stropach (lokalne jednostki modelu). */
  floors?: number;
  slabOpenings?: Opening[][];
}

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

/**
 * Drzwi bez własnego muru: ościeżnica wpuszczona 0,02 m w otwór ścianki, próg, skrzydło płycinowe
 * z klamką. Lokalny środek leży w osi ścianki; oś X biegnie wzdłuż ścianki.
 */
function buildDoor(g: THREE.Group) {
  const lightW = DOOR_OPENING.w - 0.16; // światło 1,0 m
  const lightH = DOOR_OPENING.h - 0.08; // 2,1 m
  const jambW = 0.1; // 0,08 widoczne + 0,02 w murze
  const depth = WALL_THICKNESS + 0.04;
  const frame = mat(C.woodDark);
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
  const leafMat = mat(C.wood);
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
      parts.push(add(pivot, box(panelW, ph, 0.012), mat(C.woodDark), leafX, py, side * (leafT / 2 + 0.003)));
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

function buildWindow(g: THREE.Group) {
  const winMat = mat('#eaf2ff', { emissive: '#e7f0ff', roughness: 0.4 });
  const trimMat = mat('#c7c0ae', { roughness: 0.9 });
  add(g, box(1.2, 1.5, 0.1), winMat, 0, 1.4, 0);
  add(g, box(1.4, 1.7, 0.14), trimMat, 0, 1.4, -0.02);
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

// ---------- wyposażenie wnętrz ----------

function buildTable(g: THREE.Group) {
  add(g, box(1.6, 0.1, 0.9), mat(C.wood), 0, 0.76, 0);
  add(g, box(1.5, 0.06, 0.8), mat(C.woodDark), 0, 0.7, 0);
  for (const [x, z] of [[-0.68, -0.34], [0.68, -0.34], [-0.68, 0.34], [0.68, 0.34]] as [number, number][]) {
    add(g, box(0.1, 0.72, 0.1), mat(C.woodDark), x, 0.36, z);
  }
  add(g, box(0.4, 0.04, 0.3), mat(C.paper), 0.3, 0.83, 0.1, [0, 0.3, 0]);
}

function buildShelf(g: THREE.Group) {
  add(g, box(1.4, 2.2, 0.36), mat(C.woodDark), 0, 1.1, -0.02);
  add(g, box(1.3, 2.05, 0.06), mat(C.wood), 0, 1.1, 0.14);
  const cols = [C.book1, C.book2, C.book3, C.flower3];
  for (let shelf = 0; shelf < 4; shelf++) {
    const y = 0.35 + shelf * 0.5;
    add(g, box(1.28, 0.05, 0.32), mat(C.wood), 0, y, 0);
    for (let i = 0; i < 7; i++) {
      const h = 0.28 + ((i * 7 + shelf * 3) % 5) * 0.02;
      add(g, box(0.13, h, 0.24), mat(cols[(i + shelf) % 4]), -0.53 + i * 0.17, y + h / 2 + 0.03, 0);
    }
  }
}

function buildChair(g: THREE.Group) {
  add(g, box(0.48, 0.07, 0.46), mat(C.wood), 0, 0.45, 0);
  add(g, box(0.46, 0.6, 0.07), mat(C.wood), 0, 0.75, -0.2);
  for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]] as [number, number][]) {
    add(g, box(0.06, 0.44, 0.06), mat(C.woodDark), x, 0.22, z);
  }
}

function buildPainting(g: THREE.Group) {
  // sztaluga
  add(g, cyl(0.03, 0.04, 1.6, 5), mat(C.woodDark), -0.28, 0.8, 0.12, [0.12, 0, 0.14]);
  add(g, cyl(0.03, 0.04, 1.6, 5), mat(C.woodDark), 0.28, 0.8, 0.12, [0.12, 0, -0.14]);
  add(g, cyl(0.03, 0.04, 1.5, 5), mat(C.woodDark), 0, 0.75, -0.3, [-0.2, 0, 0]);
  add(g, box(0.68, 0.05, 0.08), mat(C.wood), 0, 0.72, 0.1);
  add(g, box(0.76, 0.6, 0.05), mat(C.wood), 0, 1.05, 0.08, [0.06, 0, 0]);
  add(g, box(0.66, 0.5, 0.02), mat(C.flower3), 0, 1.05, 0.11, [0.06, 0, 0]);
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
  add(g, cyl(0.1, 0.14, 0.7, 6), mat(C.woodDark), 0.2, 1.2, -0.3);
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
  door: buildDoor,
  window: buildWindow,
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
  tower: { local: [0, 0.3, 0.85], outside: [0, 0, 2.4] },
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
  (BUILDERS[type] ?? buildObelisk)(g, { ...ctx, floorHeight: ctx?.floorHeight ?? 3.2 });
  return g;
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
    // materiały są współdzielone (cache) — nie usuwamy
  });
}
