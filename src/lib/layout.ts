import type { PalaceObject, RoomSpec, Vec3 } from '../types';
import { catalogItem } from '../catalog';
import { DOOR_OPENING, SHELLS, SHELL_WINDOWS, TOWER_R, WALL_THICKNESS, buildingFloorHeight, buildingFloorY, facadeWallsOf, floorOf, floorOfIn, isInPlace, wallLength, wallOffsetOf, worldXZ } from './rooms';

/**
 * Geometria układu pokoju w rzucie z góry: obrysy mebli i ścianek, miejsce potrzebne przy schodach
 * i sprawdzenie, czy da się przejść. Czysta matematyka bez Three.js — korzysta z niej store (miejsce
 * na schody przy dodaniu piętra) i testy układów.
 */

/** Prostokąt w rzucie: środek, połowy boków wzdłuż lokalnych osi i obrót jak `rotation[1]`. */
export interface Box2 {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
}

/** Promień kapsuły gracza w rzucie — tyle miejsca musi zostać między przeszkodami. */
export const PLAYER_R = 0.32;
export const STAIR_WIDTH = 1.2;
/** Bieg schodów z biblioteki ma 1,15 wysokości kondygnacji (jak w `buildStairs`). */
export function stairLength(floorHeight: number): number {
  return 1.15 * floorHeight;
}

/** Rozmiary mebli w rzucie (szerokość X, głębokość Z, metry przy skali 1) — zgodne z modelami z `builders.ts`. */
const SIZES: Record<string, [number, number]> = {
  table: [1.6, 0.9],
  chair: [0.5, 0.5],
  bed: [1.6, 2.1],
  desk: [1.4, 0.7],
  sideboard: [1.46, 0.54],
  sofa: [1.9, 0.9],
  armchair: [0.9, 0.9],
  shelf: [1.4, 0.4],
  bench: [1.4, 0.45],
  fireplace: [1.4, 0.6],
  chest: [0.8, 0.5],
  statue: [0.7, 0.7],
  bust: [0.4, 0.4],
  clock: [0.4, 0.3],
  easel: [0.6, 0.6],
  globe: [0.4, 0.4],
  books: [0.4, 0.4],
  dishes: [0.5, 0.5],
  candle: [0.3, 0.3],
  lantern: [0.4, 0.4],
  torch: [0.3, 0.3],
  lampion: [0.3, 0.3],
  campfire: [0.9, 0.9],
  vase: [0.2, 0.2],
};

/** Obiekty wiszące, leżące na podłodze albo przy suficie — nie blokują przejścia. */
const PASSABLE = new Set(['rug', 'ceiling_lamp', 'painting', 'curtains', 'mirror', 'window', 'balcony', 'terrace', 'door', 'pathway', 'vase', 'candle', 'dishes', 'books', 'globe']);
/** Obiekty wieszane na ścianie — układ ma sens tylko, gdy stoją przy murze albo ściance. */
export const WALL_HUNG = new Set(['painting', 'curtains', 'mirror', 'clock', 'window']);

/** Punkt lokalny prostokąta (osie wzdłuż jego boków) w świecie — ten sam obrót co `worldXZ`. */
export function boxPoint(b: Box2, lx: number, lz: number): [number, number] {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return [b.cx + lx * c + lz * s, b.cz - lx * s + lz * c];
}

/** Współrzędne lokalne punktu świata względem prostokąta. */
export function boxLocal(b: Box2, x: number, z: number): [number, number] {
  const dx = x - b.cx;
  const dz = z - b.cz;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function boxCorners(b: Box2): [number, number][] {
  return [boxPoint(b, -b.hx, -b.hz), boxPoint(b, b.hx, -b.hz), boxPoint(b, b.hx, b.hz), boxPoint(b, -b.hx, b.hz)];
}

/** Czy punkt leży w prostokącie powiększonym o `pad` z każdej strony. */
export function pointInBox(b: Box2, x: number, z: number, pad = 0): boolean {
  const [lx, lz] = boxLocal(b, x, z);
  return Math.abs(lx) <= b.hx + pad && Math.abs(lz) <= b.hz + pad;
}

/** Czy dwa obrócone prostokąty nachodzą na siebie (rozdzielające osie — boki obu). */
export function boxesOverlap(a: Box2, b: Box2, pad = 0): boolean {
  const ca = boxCorners(a);
  const cb = boxCorners(b);
  for (const box of [a, b]) {
    for (const [ax, az] of [boxPoint({ ...box, cx: 0, cz: 0 }, 1, 0), boxPoint({ ...box, cx: 0, cz: 0 }, 0, 1)]) {
      const pa = ca.map(([x, z]) => x * ax + z * az);
      const pb = cb.map(([x, z]) => x * ax + z * az);
      if (Math.max(...pa) + pad < Math.min(...pb) || Math.max(...pb) + pad < Math.min(...pa)) return false;
    }
  }
  return true;
}

/**
 * Pokój: prostokąt (albo koło o promieniu `radius` — wieża) i wysokość kondygnacji. W wieży `radius` to
 * wolne koło wewnątrz kręconych schodów, bo pierścień biegu jest zajęty na każdej kondygnacji.
 */
export interface RoomShape {
  box: Box2;
  radius?: number;
  floorHeight: number;
  /** Punkt tuż za drzwiami wejściowymi (skąd gracz wchodzi na parter). */
  entry: [number, number];
  /** Wbudowane okna muru w świecie (środek i połowa szerokości) — obraz ani lustro nie mogą ich zasłaniać. */
  windows?: { x: number; z: number; half: number }[];
}

/** Szerokość pierścienia zajętego przez kręcone schody wieży (jednostki modelu, jak `inner` w `buildTower`). */
const TOWER_STAIR_RING = 0.58;

/** Kształt wnętrza budynku z wnętrzem w miejscu, w świecie. */
export function roomOfBuilding(b: PalaceObject): RoomShape {
  const spec = SHELLS[b.type] ?? SHELLS.house;
  const [cx, cz] = worldXZ(b, spec.cx, spec.cz);
  const box: Box2 = { cx, cz, hx: (spec.inner.w / 2) * b.scale[0], hz: (spec.inner.d / 2) * b.scale[2], yaw: b.rotation[1] };
  const radius = b.type === 'tower' ? (TOWER_R - TOWER_STAIR_RING) * Math.min(b.scale[0], b.scale[2]) : undefined;
  const doorX = spec.door?.x ?? 0;
  // wejście liczymy od lica ściany w głąb pokoju, żeby kapsuła gracza mieściła się w całości
  const entry: [number, number] = radius !== undefined ? worldXZ(b, 0, radius / Math.min(b.scale[0], b.scale[2]) - 0.7 / b.scale[2]) : worldXZ(b, doorX, spec.cz + spec.inner.d / 2 - 0.7 / b.scale[2]);
  const walls = new Map(facadeWallsOf(b.type).map((w) => [w.key, w]));
  const windows = (SHELL_WINDOWS[b.type] ?? []).flatMap((win) => {
    const w = walls.get(win.wall);
    if (!w) return [];
    const [x, z] = worldXZ(b, w.cx + w.tx * win.u, w.cz + w.tz * win.u);
    return [{ x, z, half: (win.w / 2) * Math.max(b.scale[0], b.scale[2]) }];
  });
  return { box, radius, floorHeight: buildingFloorHeight(b), entry, windows };
}

/** Kształt pokoju ładowanego osobno (środek w zerze, wejście przy przedniej ścianie). */
export function roomOfSpec(spec: RoomSpec, buildingType: string): RoomShape {
  const round = buildingType === 'tower';
  const r = Math.min(spec.width, spec.depth) / 2;
  const radius = round ? r * (TOWER_R - TOWER_STAIR_RING) / TOWER_R : undefined;
  return { box: { cx: 0, cz: 0, hx: spec.width / 2, hz: spec.depth / 2, yaw: 0 }, radius, floorHeight: spec.height, entry: [0, (radius ?? spec.depth / 2) - 0.9] };
}

/** Czy punkt leży we wnętrzu pokoju z zapasem `pad` od murów (ujemny zapas = bliżej muru). */
export function insideRoom(room: RoomShape, x: number, z: number, pad = 0): boolean {
  if (room.radius !== undefined) return Math.hypot(x - room.box.cx, z - room.box.cz) <= room.radius - pad;
  return pointInBox(room.box, x, z, -pad);
}

/** Obrys schodów oraz miejsce na podejście od dołu i podest za szczytem — wszystko w świecie. */
export function stairBoxes(o: Pick<PalaceObject, 'position' | 'rotation' | 'scale'>, floorHeight: number): { steps: Box2; approach: Box2; landing: Box2 } {
  const len = stairLength(floorHeight) * o.scale[2];
  const hx = (STAIR_WIDTH / 2) * o.scale[0];
  const base: Box2 = { cx: o.position[0], cz: o.position[2], hx, hz: len / 2, yaw: o.rotation[1] };
  // model rośnie ku lokalnemu +Z: dół biegu przy −Z, szczyt przy +Z
  const [ax, az] = boxPoint(base, 0, -(len / 2 + 0.55));
  const [lx, lz] = boxPoint(base, 0, len / 2 + 0.75);
  return { steps: base, approach: { cx: ax, cz: az, hx, hz: 0.5, yaw: base.yaw }, landing: { cx: lx, cz: lz, hx, hz: 0.55, yaw: base.yaw } };
}

/** Ścianka jako prostokąty między otworami drzwi w niej zakotwiczonych. */
export function wallPieces(wall: PalaceObject, objects: PalaceObject[]): Box2[] {
  const len = wallLength(wall);
  const cuts: [number, number][] = [];
  for (const d of objects) {
    if (d.type !== 'door' || d.anchorId !== wall.id) continue;
    const { t } = wallOffsetOf(wall, d.position[0], d.position[2]);
    cuts.push([t - DOOR_OPENING.w / 2, t + DOOR_OPENING.w / 2]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  const out: Box2[] = [];
  let from = -len / 2;
  for (const [a, b] of cuts) {
    if (a > from) out.push(piece(wall, from, a));
    from = Math.max(from, b);
  }
  if (from < len / 2) out.push(piece(wall, from, len / 2));
  return out;
}

function piece(wall: PalaceObject, t0: number, t1: number): Box2 {
  const base: Box2 = { cx: wall.position[0], cz: wall.position[2], hx: 0, hz: 0, yaw: wall.rotation[1] };
  const [cx, cz] = boxPoint(base, (t0 + t1) / 2, 0);
  return { cx, cz, hx: (t1 - t0) / 2, hz: WALL_THICKNESS / 2, yaw: wall.rotation[1] };
}

/** Obrys obiektu w rzucie albo `null`, gdy nie blokuje przejścia. */
export function obstacleOf(o: PalaceObject, objects: PalaceObject[], floorHeight: number): Box2[] {
  if (o.type === 'wall') return wallPieces(o, objects);
  if (o.type === 'stairs') return [stairBoxes(o, floorHeight).steps];
  if (PASSABLE.has(o.type)) return [];
  const size = SIZES[o.type];
  const fp = catalogItem(o.type).footprint;
  const [w, d] = size ?? [fp * 0.9, fp * 0.9];
  return [{ cx: o.position[0], cz: o.position[2], hx: (w / 2) * o.scale[0], hz: (d / 2) * o.scale[2], yaw: o.rotation[1] }];
}

/** Siatka przejść: komórki 0,2 m; zablokowane, gdy kapsuła gracza zahaczyłaby o przeszkodę albo mur. */
export class WalkGrid {
  readonly cell = 0.2;
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly blocked: Uint8Array;

  constructor(readonly room: RoomShape, obstacles: Box2[]) {
    const reach = room.radius ?? Math.hypot(room.box.hx, room.box.hz);
    this.x0 = room.box.cx - reach;
    this.z0 = room.box.cz - reach;
    this.nx = Math.ceil((2 * reach) / this.cell) + 1;
    this.nz = this.nx;
    this.blocked = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + i * this.cell;
        const z = this.z0 + j * this.cell;
        let bad = !insideRoom(room, x, z, PLAYER_R);
        if (!bad) for (const b of obstacles) if (pointInBox(b, x, z, PLAYER_R)) { bad = true; break; }
        this.blocked[j * this.nx + i] = bad ? 1 : 0;
      }
    }
  }

  private index(x: number, z: number): number | null {
    const i = Math.round((x - this.x0) / this.cell);
    const j = Math.round((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return null;
    return j * this.nx + i;
  }

  /** Wszystkie komórki osiągalne z punktu startowego (BFS po czterech sąsiadach). */
  reachable(fromX: number, fromZ: number): Uint8Array {
    const seen = new Uint8Array(this.nx * this.nz);
    const start = this.index(fromX, fromZ);
    if (start === null || this.blocked[start]) return seen;
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const k = queue.pop()!;
      const i = k % this.nx;
      const j = (k - i) / this.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) continue;
        const kk = jj * this.nx + ii;
        if (seen[kk] || this.blocked[kk]) continue;
        seen[kk] = 1;
        queue.push(kk);
      }
    }
    return seen;
  }

  /** Czy jakaś osiągalna komórka leży w promieniu `r` od punktu (da się do niego podejść). */
  near(seen: Uint8Array, x: number, z: number, r: number): boolean {
    const steps = Math.ceil(r / this.cell);
    const i0 = Math.round((x - this.x0) / this.cell);
    const j0 = Math.round((z - this.z0) / this.cell);
    for (let j = j0 - steps; j <= j0 + steps; j++) {
      for (let i = i0 - steps; i <= i0 + steps; i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        if (!seen[j * this.nx + i]) continue;
        if (Math.hypot(i - i0, j - j0) * this.cell <= r) return true;
      }
    }
    return false;
  }
}

/** Piętro obiektu w pokoju (pozycja Y względem podłogi parteru `baseY`). */
function floorIndex(o: PalaceObject, baseY: number, H: number): number {
  return floorOf(o.position[1] - baseY, H);
}

/**
 * Lista problemów układu (po polsku, pusta = układ w porządku): obiekty poza pokojem, schody w ścianach albo
 * bez podejścia i podestu, meble, do których nie da się dojść, drzwi nieosiągalne, wiszące obiekty z dala od ścian,
 * krzesła bez stołu. `baseY` to wysokość podłogi parteru w świecie.
 */
export function layoutProblems(room: RoomShape, objects: PalaceObject[], floors: number, baseY = 0): string[] {
  const H = room.floorHeight;
  const out: string[] = [];
  const name = (o: PalaceObject) => `${catalogItem(o.type).name} (${o.position.map((v) => v.toFixed(1)).join(', ')})`;
  const hasFurniture = objects.some((o) => !PASSABLE.has(o.type) && o.type !== 'wall' && o.type !== 'stairs' && o.type !== 'ceiling_lamp');
  for (let k = 0; k < floors; k++) {
    const onFloor = objects.filter((o) => floorIndex(o, baseY, H) === k);
    const below = objects.filter((o) => floorIndex(o, baseY, H) === k - 1 && o.type === 'stairs');
    const obstacles: Box2[] = [];
    for (const o of onFloor) obstacles.push(...obstacleOf(o, objects, H));
    // otwór w stropie nad schodami z piętra niżej — na tym piętrze to dziura, nie podłoga
    const holes: Box2[] = below.map((s) => {
      const b = stairBoxes(s, H).steps;
      return { ...b, hx: b.hx + 0.15, hz: b.hz + 0.15 };
    });
    // 1. wszystko w obrysie pokoju
    for (const o of onFloor) {
      const pad = WALL_HUNG.has(o.type) || o.type === 'wall' || o.type === 'door' ? -0.3 : 0.05;
      for (const b of obstacleOf(o, objects, H)) {
        if (!boxCorners(b).every(([x, z]) => insideRoom(room, x, z, pad))) out.push(`piętro ${k}: ${name(o)} wystaje poza pokój`);
      }
      if (!insideRoom(room, o.position[0], o.position[2], pad)) out.push(`piętro ${k}: ${name(o)} stoi poza pokojem`);
    }
    // 2. schody: nie w ścianach ani meblach, z podejściem i podestem w pokoju
    for (const s of onFloor.filter((o) => o.type === 'stairs')) {
      const { steps, approach, landing } = stairBoxes(s, H);
      const others = onFloor.filter((o) => o.id !== s.id).flatMap((o) => obstacleOf(o, objects, H));
      for (const [label, box] of [['bieg', steps], ['podejście', approach], ['podest', landing]] as [string, Box2][]) {
        if (!boxCorners(box).every(([x, z]) => insideRoom(room, x, z, label === 'bieg' ? 0.02 : 0.1))) out.push(`piętro ${k}: schody — ${label} wychodzi poza pokój`);
        if (others.some((b) => boxesOverlap(box, b))) out.push(`piętro ${k}: schody — ${label} przecina ścianę albo mebel`);
      }
      // podest musi leżeć na stropie, nie nad własnym otworem — ten sprawdza piętro wyżej, tu prześwit nad biegiem
    }
    // 3. przejścia: od wejścia (parter) albo od szczytu schodów (piętra) do każdych drzwi, mebla i schodów
    if (room.radius !== undefined) continue; // wieża: pierścień schodów zajmuje obrzeże, środek jest zawsze wolny
    const grid = new WalkGrid(room, [...obstacles, ...holes]);
    const starts: [number, number][] = k === 0 ? [room.entry] : below.map((s) => [stairBoxes(s, H).landing.cx, stairBoxes(s, H).landing.cz]);
    if (starts.length === 0) {
      if (k > 0 && onFloor.length > 0) out.push(`piętro ${k}: brak schodów prowadzących na to piętro`);
      continue;
    }
    const seen = starts.map(([x, z]) => grid.reachable(x, z));
    const reach = (x: number, z: number, r: number) => seen.some((s) => grid.near(s, x, z, r));
    if (!starts.some(([x, z]) => reach(x, z, 0.3))) out.push(`piętro ${k}: wejście zastawione`);
    const anchoredOnObject = (o: PalaceObject) => !!o.anchorId && objects.some((x) => x.id === o.anchorId);
    for (const o of onFloor) {
      if (o.type === 'wall' || o.type === 'ceiling_lamp' || o.type === 'rug' || o.type === 'window') continue;
      // obraz nad kredensem i wazon na stole nie wymagają miejsca na podłodze — liczy się, że są przy ścianie/na czymś
      if (WALL_HUNG.has(o.type) || anchoredOnObject(o)) continue;
      if (o.type === 'stairs') {
        const { approach } = stairBoxes(o, H);
        if (!reach(approach.cx, approach.cz, 0.35)) out.push(`piętro ${k}: nie da się dojść do schodów ${name(o)}`);
        continue;
      }
      if (o.type === 'door') {
        // po obu stronach drzwi musi być dojście — inaczej pokój za nimi jest odcięty
        const base: Box2 = { cx: o.position[0], cz: o.position[2], hx: 0, hz: 0, yaw: o.rotation[1] };
        for (const side of [-1, 1]) {
          const [x, z] = boxPoint(base, 0, side * 0.75);
          if (!reach(x, z, 0.3)) out.push(`piętro ${k}: drzwi ${name(o)} — brak dojścia z jednej strony`);
        }
        continue;
      }
      const boxes = obstacleOf(o, objects, H);
      const r = boxes.length ? Math.hypot(boxes[0].hx, boxes[0].hz) + 0.75 : 0.75;
      if (!reach(o.position[0], o.position[2], r)) out.push(`piętro ${k}: nie da się podejść do ${name(o)}`);
    }
    // 4. wiszące przy ścianie, krzesła przy stole
    const wallsHere = onFloor.filter((o) => o.type === 'wall').flatMap((w) => wallPieces(w, objects));
    for (const o of onFloor) {
      if (WALL_HUNG.has(o.type)) {
        const nearShell = !insideRoom(room, o.position[0], o.position[2], 0.6);
        const nearWall = wallsHere.some((b) => pointInBox(b, o.position[0], o.position[2], 0.45));
        const nearFireplace = o.type === 'clock' || o.type === 'painting' ? onFloor.some((f) => f.type === 'fireplace' && Math.hypot(f.position[0] - o.position[0], f.position[2] - o.position[2]) < 1.2) : false;
        if (!nearShell && !nearWall && !nearFireplace) out.push(`piętro ${k}: ${name(o)} wisi z dala od ściany`);
        // wiszące na murze nie mogą zasłaniać wbudowanego okna
        const half = (catalogItem(o.type).footprint * 0.9) / 2;
        if (nearShell && (room.windows ?? []).some((win) => Math.hypot(win.x - o.position[0], win.z - o.position[2]) < win.half + half)) {
          out.push(`piętro ${k}: ${name(o)} zasłania wbudowane okno`);
        }
      }
      if (o.type === 'chair' && hasFurniture) {
        const tables = onFloor.filter((t) => t.type === 'table' || t.type === 'desk');
        const ok = tables.some((t) => Math.hypot(t.position[0] - o.position[0], t.position[2] - o.position[2]) < 1.35);
        if (tables.length > 0 && !ok) out.push(`piętro ${k}: ${name(o)} stoi z dala od stołu`);
      }
    }
    // 5. meble nie nachodzą na siebie ani na ścianki
    for (let i = 0; i < onFloor.length; i++) {
      for (let j = i + 1; j < onFloor.length; j++) {
        const a = onFloor[i];
        const b = onFloor[j];
        if (a.anchorId === b.id || b.anchorId === a.id) continue;
        if (a.type === 'door' || b.type === 'door') continue;
        for (const ba of obstacleOf(a, objects, H)) for (const bb of obstacleOf(b, objects, H)) if (boxesOverlap(ba, bb, -0.02)) out.push(`piętro ${k}: ${name(a)} nachodzi na ${name(b)}`);
      }
    }
  }
  return out;
}

/**
 * Miejsce na schody z biblioteki w budynku z wnętrzem w miejscu: bieg z podejściem od dołu i podestem za
 * szczytem musi zmieścić się w pokoju, nie przecinać ścianek ani mebli, nie zastawiać wejścia i drzwi,
 * a do jego dołu musi dać się dojść od wejścia. Z pasujących miejsc wybieramy to najbliżej ściany
 * (schody pośrodku pokoju przeszkadzałyby). Zwraca pozycję i obrót w świecie albo `null`.
 */
export function findStairsSpot(b: PalaceObject, objects: PalaceObject[]): { position: Vec3; rotationY: number } | null {
  if (!isInPlace(b) || b.type === 'tower') return null;
  const inside = objects.filter((o) => o.id !== b.id && (o.anchorId === b.id || objects.some((p) => p.id === o.anchorId && p.anchorId === b.id)));
  const ground = inside.filter((o) => floorOfIn(b, o.position[1]) === 0);
  return findStairsIn(roomOfBuilding(b), ground, objects, buildingFloorY(b, 0));
}

/** To samo dla pokoju ładowanego osobno (albo dowolnego kształtu): `ground` to obiekty stojące na parterze. */
export function findStairsIn(room: RoomShape, ground: PalaceObject[], objects: PalaceObject[], baseY: number): { position: Vec3; rotationY: number } | null {
  if (room.radius !== undefined) return null; // wieża ma schody wbudowane w mur
  const H = room.floorHeight;
  const len = stairLength(H);
  const obstacles = ground.flatMap((o) => obstacleOf(o, objects, H));
  const doors = ground.filter((o) => o.type === 'door');
  const { hx, hz, yaw } = room.box;
  type Cand = { position: Vec3; rotationY: number; score: number; approach: Box2 };
  const cands: Cand[] = [];
  const step = 0.4;
  for (let q = 0; q < 4; q++) {
    const rotationY = yaw + (q * Math.PI) / 2;
    for (let lx = -hx + step; lx <= hx - step; lx += step) {
      for (let lz = -hz + step; lz <= hz - step; lz += step) {
        const [x, z] = boxPoint(room.box, lx, lz);
        const cand = { position: [x, baseY, z] as Vec3, rotation: [0, rotationY, 0] as Vec3, scale: [1, 1, 1] as Vec3 };
        const { steps, approach, landing } = stairBoxes(cand, H);
        if (![steps, approach, landing].every((box) => boxCorners(box).every(([px, pz]) => insideRoom(room, px, pz, 0.1)))) continue;
        if ([steps, approach, landing].some((box) => obstacles.some((o) => boxesOverlap(box, o, 0.1)))) continue;
        // światło drzwi ścianek i wejście do budynku muszą zostać wolne
        if (doors.some((d) => pointInBox(steps, d.position[0], d.position[2], 0.9) || pointInBox(approach, d.position[0], d.position[2], 0.6))) continue;
        if ([steps, approach, landing].some((box) => pointInBox(box, room.entry[0], room.entry[1], 0.5))) continue;
        // bieg przy ścianie: im bliżej muru, tym lepiej (środek pokoju zostaje przejezdny)
        const toWall = Math.min(hx - Math.abs(lx), hz - Math.abs(lz));
        cands.push({ position: cand.position, rotationY, score: toWall, approach });
      }
    }
  }
  cands.sort((a, b2) => a.score - b2.score);
  for (const c of cands.slice(0, 40)) {
    // do dołu schodów trzeba dojść od wejścia — inaczej piętro i tak jest nieosiągalne
    const withStairs = [...obstacles, stairBoxes({ position: c.position, rotation: [0, c.rotationY, 0], scale: [1, 1, 1] }, H).steps];
    const grid = new WalkGrid(room, withStairs);
    const seen = grid.reachable(room.entry[0], room.entry[1]);
    if (grid.near(seen, c.approach.cx, c.approach.cz, 0.35)) return { position: c.position, rotationY: c.rotationY };
  }
  return null;
}
