import { ROOMS, catalogItem } from '../catalog';
import type { Palace, PalaceObject, RoomSpec, Vec3 } from '../types';

/** Najwyższe piętro, jakie można ustawić budynkowi. */
export const FLOOR_MAX = 4;

/** Piętro, na którym stoi obiekt, licząc z wysokości — brak pola we danych. */
export function floorOf(y: number, floorHeight: number): number {
  return Math.floor((y + 0.05) / floorHeight);
}

/** Wymiary pokoju wynikające ze skali budynku-rodzica i liczby pięter zapisanej we wnętrzu. */
export function roomSpecFor(palace: Palace, palaces: Palace[]): RoomSpec & { floors: number } {
  const type = palace.interior?.buildingType ?? 'house';
  const base = ROOMS[type] ?? ROOMS.house;
  const floors = Math.min(FLOOR_MAX, Math.max(1, palace.interior?.floors ?? 1));
  const parent = palace.parentId ? palaces.find((p) => p.id === palace.parentId) : undefined;
  const obj = parent?.objects.find((o) => o.id === palace.parentObjectId);
  const scale = obj?.scale ?? [1, 1, 1];
  const width = clamp(base.width * scale[0], 4, 40);
  const depth = clamp(base.depth * scale[2], 4, 40);
  return { ...base, width, depth, floors };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Lampy sufitowe wnętrza: dwie (trzy w szerokich pokojach) na każdą kondygnację, w osi pokoju. */
export function roomLamps(spec: { width: number; height: number }, floors: number, makeId: () => string): PalaceObject[] {
  const n = spec.width >= 12 ? 3 : 2;
  const name = catalogItem('ceiling_lamp').name;
  const out: PalaceObject[] = [];
  for (let k = 0; k < Math.max(1, floors); k++) {
    for (let i = 0; i < n; i++) {
      const x = -spec.width * 0.28 + (i * (spec.width * 0.56)) / (n - 1);
      out.push({ id: makeId(), type: 'ceiling_lamp', name, position: [x, k * spec.height, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    }
  }
  return out;
}

/** Miejsce, w którym stoi obiekt na płaszczyźnie pokoju, przycięte do wnętrza z zapasem od ścian. */
export function clampToRoom(spec: { width: number; depth: number }, x: number, z: number, margin = 0.4): [number, number] {
  const hx = Math.max(spec.width / 2 - margin, 0.3);
  const hz = Math.max(spec.depth / 2 - margin, 0.3);
  return [Math.min(hx, Math.max(-hx, x)), Math.min(hz, Math.max(-hz, z))];
}

/** Prostokątny otwór w stropie (obrys schodów w rzucie z góry, z zapasem). */
export interface Opening {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
}

/** Obrys schodów jako otwory w stropie nad kondygnacją, na której stoją. Indeks tablicy = piętro startowe. */
export function stairOpenings(objects: PalaceObject[], floorHeight: number): Opening[][] {
  const byFloor = new Map<number, Opening[]>();
  const halfLen = (1.15 * floorHeight) / 2;
  const halfWidth = 0.6;
  for (const o of objects) {
    if (o.type !== 'stairs') continue;
    const floor = floorOf(o.position[1], floorHeight);
    const cos = Math.abs(Math.cos(o.rotation[1]));
    const sin = Math.abs(Math.sin(o.rotation[1]));
    const hx = cos * halfWidth * o.scale[0] + sin * halfLen * o.scale[2] + 0.15;
    const hz = sin * halfWidth * o.scale[0] + cos * halfLen * o.scale[2] + 0.15;
    const list = byFloor.get(floor) ?? [];
    list.push({ cx: o.position[0], cz: o.position[2], hx, hz });
    byFloor.set(floor, list);
  }
  const maxFloor = Math.max(-1, ...byFloor.keys());
  const out: Opening[][] = [];
  for (let i = 0; i <= maxFloor; i++) out.push(byFloor.get(i) ?? []);
  return out;
}

// ---------- ścianki działowe i drzwi ----------

/** Długość bazowego segmentu ścianki (`scale[0]` mnoży ją wzdłuż osi X obiektu). */
export const WALL_SEGMENT = 2.0;
export const WALL_THICKNESS = 0.24;
/**
 * Otwór wycinany w ściance pod drzwi: światło 1,0 × 2,1 plus ościeżnica po 0,08 z każdej strony,
 * wpuszczona 0,02 m w mur (dzięki temu żadna ścianka ościeżnicy nie leży w płaszczyźnie muru).
 */
export const DOOR_OPENING = { w: 1.16, h: 2.18 };
/** Najmniejszy odstęp między osiami dwóch drzwi w tej samej ściance. */
export const DOOR_SLOT = DOOR_OPENING.w + 0.1;

/** Typy rysowane dwoma kliknięciami (początek i koniec): ścianka i ścieżka. Długość = `scale[0] × WALL_SEGMENT`. */
export function isDrawn(type: string): boolean {
  return type === 'wall' || type === 'pathway';
}

export function wallLength(wall: Pick<PalaceObject, 'scale'>): number {
  return wall.scale[0] * WALL_SEGMENT;
}

/** Wektor jednostkowy wzdłuż ścianki w rzucie z góry (lokalna oś X obrócona o `rotation[1]`). */
export function wallAxis(wall: Pick<PalaceObject, 'rotation'>): [number, number] {
  return [Math.cos(wall.rotation[1]), -Math.sin(wall.rotation[1])];
}

/** Rzut punktu na oś ścianki: `t` wzdłuż od środka (w metrach świata), `dist` w poprzek. */
export function wallOffsetOf(wall: Pick<PalaceObject, 'position' | 'rotation'>, x: number, z: number): { t: number; dist: number } {
  const [ax, az] = wallAxis(wall);
  const dx = x - wall.position[0];
  const dz = z - wall.position[2];
  return { t: dx * ax + dz * az, dist: Math.abs(-dx * az + dz * ax) };
}

/** Punkt na osi ścianki w odległości `t` od jej środka. */
export function wallPointAt(wall: Pick<PalaceObject, 'position' | 'rotation'>, t: number): [number, number] {
  const [ax, az] = wallAxis(wall);
  return [wall.position[0] + ax * t, wall.position[2] + az * t];
}

/** Zakres `t`, w którym mieści się cały otwór drzwiowy. */
export function doorRange(wall: Pick<PalaceObject, 'scale'>): number {
  return Math.max(0, wallLength(wall) / 2 - DOOR_OPENING.w / 2);
}

/** Położenia (wzdłuż osi, w metrach świata) drzwi zakotwiczonych w ściance i mieszczących się w niej. */
export function doorOffsets(wall: PalaceObject, objects: PalaceObject[]): number[] {
  const range = doorRange(wall);
  const out: number[] = [];
  for (const o of objects) {
    if (o.type !== 'door' || o.anchorId !== wall.id) continue;
    const { t } = wallOffsetOf(wall, o.position[0], o.position[2]);
    if (Math.abs(t) <= range + 1e-6) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/** Czy w miejscu `t` ścianki nie ma jeszcze innych drzwi (poza `ignoreId`). */
export function doorSlotFree(wall: PalaceObject, objects: PalaceObject[], t: number, ignoreId?: string): boolean {
  for (const o of objects) {
    if (o.type !== 'door' || o.anchorId !== wall.id || o.id === ignoreId) continue;
    const { t: ot } = wallOffsetOf(wall, o.position[0], o.position[2]);
    if (Math.abs(ot - t) < DOOR_SLOT) return false;
  }
  return true;
}

/**
 * Dawne drzwi były własnym segmentem ściany; teraz drzwi żyją w ściance (`anchorId`).
 * Drzwi bez kotwicy w ściance dostają ściankę 2,0 m w tym samym miejscu. Idempotentne.
 */
export function attachLegacyDoors(objects: PalaceObject[], makeId: () => string): PalaceObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const added: PalaceObject[] = [];
  for (const o of objects) {
    if (o.type !== 'door') continue;
    const anchor = o.anchorId ? byId.get(o.anchorId) : undefined;
    if (anchor?.type === 'wall') continue;
    const wall: PalaceObject = {
      id: makeId(),
      type: 'wall',
      name: catalogItem('wall').name,
      position: [o.position[0], o.position[1], o.position[2]],
      rotation: [0, o.rotation[1], 0],
      scale: [o.scale[0], 1, 1],
    };
    o.anchorId = wall.id;
    added.push(wall);
  }
  return added.length ? [...objects, ...added] : objects;
}

/** Czy dwie ścianki leżą w jednej linii (kąt ±1°, oś w odległości < 5 cm) i stykają się albo nachodzą. */
export function collinearWalls(a: PalaceObject, b: PalaceObject): boolean {
  const d = (((a.rotation[1] - b.rotation[1]) % Math.PI) + Math.PI) % Math.PI;
  if (Math.min(d, Math.PI - d) > 0.02) return false;
  const { t, dist } = wallOffsetOf(a, b.position[0], b.position[2]);
  if (dist > 0.05) return false;
  return Math.abs(t) <= (wallLength(a) + wallLength(b)) / 2 + 0.05;
}

/** Składowe spójne relacji „współliniowe i stykające się” — każda to łańcuch do scalenia. */
export function wallChains(walls: PalaceObject[]): PalaceObject[][] {
  const left = [...walls];
  const out: PalaceObject[][] = [];
  while (left.length) {
    const chain = [left.shift()!];
    for (let i = 0; i < chain.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) {
        if (collinearWalls(chain[i], left[j])) chain.push(left.splice(j, 1)[0]);
      }
    }
    out.push(chain);
  }
  return out;
}

/** Jedna ścianka w miejsce łańcucha: skrajne końce wyznaczają środek i długość, obrót z pierwszej. */
export function mergedWall(chain: PalaceObject[]): { position: Vec3; rotation: Vec3; scale: Vec3 } {
  const base = chain[0];
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const w of chain) {
    for (const end of [-wallLength(w) / 2, wallLength(w) / 2]) {
      const [x, z] = wallPointAt(w, end);
      const { t } = wallOffsetOf(base, x, z);
      tMin = Math.min(tMin, t);
      tMax = Math.max(tMax, t);
    }
  }
  const [mx, mz] = wallPointAt(base, (tMin + tMax) / 2);
  return { position: [mx, base.position[1], mz], rotation: [0, base.rotation[1], 0], scale: [(tMax - tMin) / WALL_SEGMENT, base.scale[1], base.scale[2]] };
}

// ---------- powłoki budynków (wnętrze w tej samej scenie) ----------

/** Wymiary wnętrza budynku w jednostkach lokalnych modelu (przed skalą obiektu). */
export interface ShellSpec {
  inner: { w: number; d: number; h: number };
  /** Środek wnętrza w rzucie (modele mają korpus przesunięty względem podstawy). */
  cx: number;
  cz: number;
  /** Wierzch podłogi. */
  floorY: number;
  /** Otwór drzwiowy w ścianie frontowej (brak = wejście bez drzwi, np. świątynia). */
  door?: { x: number; z: number; w: number; h: number };
  /** Najmniejsza skala, przy której kapsuła gracza (1,74 m) przechodzi pod nadprożem drzwi. */
  minScale: number;
  /** Liczba kondygnacji nowego budynku i najwyższa dopuszczalna — każda dokłada `inner.h` do wysokości bryły. */
  defaultFloors: number;
  maxFloors: number;
}

/** Promień wewnętrznego lica muru wieży (jednostki modelu). */
export const TOWER_R = 2.0;

/**
 * Wnętrza o realistycznej powierzchni: domek 10,4 × 9,6 m przy skali 2, pałac 11,2 × 9,8 m przy 1,7,
 * biblioteka 10,2 × 9,5 m przy 1,65, świątynia 7,7 × 6,4 m, wieża o średnicy 10 m przy 2,5 — jest miejsce na
 * klatkę schodową z podejściem i podestem, ścianki działowe i meble. Wysokości kondygnacji bez zmian.
 */
export const SHELLS: Record<string, ShellSpec> = {
  house: { inner: { w: 5.2, d: 4.8, h: 1.4 }, cx: 0, cz: 0, floorY: 0.16, door: { x: -1.2, z: 2.46, w: 0.5, h: 1.0 }, minScale: 2.0, defaultFloors: 1, maxFloors: 2 },
  palace: { inner: { w: 6.56, d: 5.76, h: 1.9 }, cx: 0, cz: -0.2, floorY: 0.44, door: { x: 0, z: 2.74, w: 0.6, h: 1.1 }, minScale: 1.7, defaultFloors: 1, maxFloors: 2 },
  library: { inner: { w: 6.16, d: 5.76, h: 1.7 }, cx: 0, cz: -0.2, floorY: 0.24, door: { x: 0, z: 2.74, w: 0.7, h: 1.15 }, minScale: 1.65, defaultFloors: 1, maxFloors: 2 },
  temple: { inner: { w: 4.8, d: 4.0, h: 1.5 }, cx: 0, cz: 0, floorY: 0.36, minScale: 1.6, defaultFloors: 1, maxFloors: 1 },
  tower: { inner: { w: 4.0, d: 4.0, h: 1.4 }, cx: 0, cz: 0, floorY: 0.3, door: { x: 0, z: 2.0, w: 0.43, h: 1.0 }, minScale: 2.5, defaultFloors: 3, maxFloors: 4 },
};

/**
 * Bryły wbudowane w powłokę, które stoją w środku pokoju i zajmują miejsce tak samo jak meble
 * (świątynia: osiem kolumn i blok ołtarza). Jednostki modelu, wspólne dla `buildTemple` i sprawdzania układów.
 */
export function shellFixedBoxes(type: string): { cx: number; cz: number; hx: number; hz: number }[] {
  if (type !== 'temple') return [];
  const { w, d } = SHELLS.temple.inner;
  const cx = w / 2 - 0.3;
  const cz = d / 2 - 0.3;
  // pośrodku frontu kolumny nie ma — tamtędy się wchodzi
  const cols: [number, number][] = [[-cx, cz], [cx, cz], [-cx, -cz], [cx, -cz], [0, -cz], [-cx, 0], [cx, 0]];
  return [...cols.map(([x, z]) => ({ cx: x, cz: z, hx: 0.15, hz: 0.15 })), { cx: 0, cz: -d * 0.3, hx: 0.4, hz: 0.4 }];
}

/** Budynek z wnętrzem w tej samej scenie (bez ładowania osobnego pałacu). */
export function isInPlace(o: Pick<PalaceObject, 'type' | 'interiorMode'>): boolean {
  return o.interiorMode === 'inplace' && o.type in SHELLS;
}

/** Wysokość jednej kondygnacji budynku w metrach świata — stała, każde piętro podwyższa bryłę. */
export function buildingFloorHeight(b: PalaceObject): number {
  const spec = SHELLS[b.type] ?? SHELLS.house;
  return spec.inner.h * b.scale[1];
}

/** Najwyższa liczba pięter dla typu budynku z wnętrzem w miejscu. */
export function maxFloorsOf(type: string): number {
  return SHELLS[type]?.maxFloors ?? 1;
}

/** Wysokość podłogi piętra `k` budynku w świecie. */
export function buildingFloorY(b: PalaceObject, k: number): number {
  const spec = SHELLS[b.type] ?? SHELLS.house;
  return b.position[1] + spec.floorY * b.scale[1] + k * buildingFloorHeight(b);
}

/** Piętro budynku, na którym stoi obiekt o wysokości `y` (świat). */
export function floorOfIn(b: PalaceObject, y: number): number {
  const k = floorOf(y - buildingFloorY(b, 0), buildingFloorHeight(b));
  return Math.min(Math.max(0, k), Math.max(1, b.floors ?? 1) - 1);
}

/** Budynek z wnętrzem w miejscu, w którym stoi obiekt (przez łańcuch kotwic), albo `undefined`. */
export function buildingOf(objects: PalaceObject[], o: PalaceObject): PalaceObject | undefined {
  const byId = new Map(objects.map((x) => [x.id, x]));
  const seen = new Set<string>([o.id]);
  let cur = o.anchorId ? byId.get(o.anchorId) : undefined;
  while (cur && !seen.has(cur.id)) {
    if (isInPlace(cur)) return cur;
    seen.add(cur.id);
    cur = cur.anchorId ? byId.get(cur.anchorId) : undefined;
  }
  return undefined;
}

/** Punkt świata w układzie lokalnym modelu budynku (obrót wokół osi pionowej i skala). */
export function localXZ(b: PalaceObject, x: number, z: number): [number, number] {
  const dx = x - b.position[0];
  const dz = z - b.position[2];
  const c = Math.cos(b.rotation[1]);
  const s = Math.sin(b.rotation[1]);
  // odwrotność obrotu R_y(yaw): lokalny X = (cos, -sin) w świecie
  return [(dx * c - dz * s) / b.scale[0], (dx * s + dz * c) / b.scale[2]];
}

/** Punkt lokalny modelu budynku w świecie (odwrotność `localXZ`). */
export function worldXZ(b: PalaceObject, lx: number, lz: number): [number, number] {
  const x = lx * b.scale[0];
  const z = lz * b.scale[2];
  const c = Math.cos(b.rotation[1]);
  const s = Math.sin(b.rotation[1]);
  return [b.position[0] + x * c + z * s, b.position[2] - x * s + z * c];
}

/**
 * Otwory w stropach budynku nad schodami w nim zakotwiczonymi — w jednostkach lokalnych modelu
 * (indeks tablicy = piętro startowe schodów). Wzór: `stairOpenings`.
 */
export function buildingOpenings(b: PalaceObject, objects: PalaceObject[]): Opening[][] {
  const byFloor = new Map<number, Opening[]>();
  const H = buildingFloorHeight(b);
  const halfLen = (1.15 * H) / 2;
  const halfWidth = 0.6;
  for (const o of objects) {
    if (o.type !== 'stairs' || o.anchorId !== b.id) continue;
    const floor = floorOfIn(b, o.position[1]);
    const rel = o.rotation[1] - b.rotation[1];
    const cos = Math.abs(Math.cos(rel));
    const sin = Math.abs(Math.sin(rel));
    const hx = (cos * halfWidth * o.scale[0] + sin * halfLen * o.scale[2] + 0.15) / b.scale[0];
    const hz = (sin * halfWidth * o.scale[0] + cos * halfLen * o.scale[2] + 0.15) / b.scale[2];
    const [cx, cz] = localXZ(b, o.position[0], o.position[2]);
    const list = byFloor.get(floor) ?? [];
    list.push({ cx, cz, hx, hz });
    byFloor.set(floor, list);
  }
  const out: Opening[][] = [];
  for (let i = 0; i < Math.max(1, b.floors ?? 1) - 1; i++) out.push(byFloor.get(i) ?? []);
  return out;
}

// ---------- elewacja: okna, balkony i tarasy w murze budynku ----------

/** Otwory elewacji w metrach świata: szerokość, wysokość i parapet nad podłogą piętra. */
export const FACADE: Record<string, { w: number; h: number; sill: number; minFloor: number; maxFloor: number }> = {
  window: { w: 1.0, h: 1.2, sill: 0.9, minFloor: 0, maxFloor: 99 },
  balcony: { w: 1.0, h: 2.1, sill: 0, minFloor: 1, maxFloor: 99 },
  terrace: { w: 1.0, h: 2.1, sill: 0, minFloor: 0, maxFloor: 0 },
};
export const SHELL_WALL_T = 0.06;

export function isFacade(type: string): boolean {
  return type in FACADE;
}

/** Ściana powłoki w układzie lokalnym modelu: punkt środka lica zewnętrznego, normalna na zewnątrz, zakres `u` wzdłuż. */
export interface FacadeWall {
  key: string;
  cx: number;
  cz: number;
  nx: number;
  nz: number;
  /** Kierunek osi `u` ściany — zgodny z układem, w którym `wallGeometry` wycina otwory (x modelu dla ścian
   * przednich i tylnych, z modelu dla bocznych, styczna dla segmentów wieży). */
  tx: number;
  tz: number;
  /** Połowa długości ściany wzdłuż `u`. */
  half: number;
}

export function facadeWalls(b: Pick<PalaceObject, 'type'>): FacadeWall[] {
  return facadeWallsOf(b.type);
}

export function facadeWallsOf(type: string): FacadeWall[] {
  const spec = SHELLS[type];
  if (!spec) return [];
  if (type === 'tower') {
    const r = TOWER_R + 0.05;
    const side = 2 * TOWER_R * Math.tan(Math.PI / 12);
    return Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return { key: `seg${i}`, cx: Math.sin(a) * r, cz: Math.cos(a) * r, nx: Math.sin(a), nz: Math.cos(a), tx: Math.cos(a), tz: -Math.sin(a), half: side / 2 };
    });
  }
  if (type === 'temple') return []; // świątynia nie ma murów
  const { w, d } = spec.inner;
  const t = SHELL_WALL_T;
  return [
    { key: 'front', cx: 0, cz: spec.cz + d / 2 + t, nx: 0, nz: 1, tx: 1, tz: 0, half: w / 2 + t },
    { key: 'back', cx: 0, cz: spec.cz - d / 2 - t, nx: 0, nz: -1, tx: 1, tz: 0, half: w / 2 + t },
    { key: 'left', cx: spec.cx - w / 2 - t, cz: 0, nx: -1, nz: 0, tx: 0, tz: 1, half: d / 2 },
    { key: 'right', cx: spec.cx + w / 2 + t, cz: 0, nx: 1, nz: 0, tx: 0, tz: 1, half: d / 2 },
  ];
}


/** Okno wbudowane w mur budynku: ściana (klucz z `facadeWallsOf`), `u` wzdłuż niej i wymiary — jednostki modelu. */
export interface ShellWindow {
  wall: string;
  u: number;
  w: number;
  h: number;
  /** Parapet nad podłogą piętra. */
  sill: number;
}

/**
 * Okna elewacji każdego typu budynku — jeden spis dla bryły z zewnątrz, powłoki w miejscu i pokoju ładowanego,
 * żeby okna w środku odpowiadały tym na zewnątrz. Powtarzane na każdym piętrze.
 */
export const SHELL_WINDOWS: Record<string, ShellWindow[]> = {
  house: [
    { wall: 'front', u: 1.2, w: 0.4, h: 0.4, sill: 0.65 },
    // środek tylnej ściany zostaje wolny na kominek, kredens albo wezgłowie łóżka
    { wall: 'back', u: -1.9, w: 0.4, h: 0.4, sill: 0.65 },
    { wall: 'back', u: 1.9, w: 0.4, h: 0.4, sill: 0.65 },
    { wall: 'left', u: -1.0, w: 0.4, h: 0.4, sill: 0.65 },
    { wall: 'left', u: 1.0, w: 0.4, h: 0.4, sill: 0.65 },
    { wall: 'right', u: -1.0, w: 0.4, h: 0.4, sill: 0.65 },
    { wall: 'right', u: 1.0, w: 0.4, h: 0.4, sill: 0.65 },
  ],
  palace: [
    { wall: 'front', u: -2.1, w: 0.36, h: 0.5, sill: 0.85 },
    { wall: 'front', u: 2.1, w: 0.36, h: 0.5, sill: 0.85 },
    { wall: 'back', u: -2.1, w: 0.36, h: 0.5, sill: 0.85 },
    { wall: 'back', u: 0, w: 0.36, h: 0.5, sill: 0.85 },
    { wall: 'back', u: 2.1, w: 0.36, h: 0.5, sill: 0.85 },
    { wall: 'left', u: -1.5, w: 0.36, h: 0.5, sill: 0.85 },
    { wall: 'left', u: 1.1, w: 0.36, h: 0.5, sill: 0.85 },
    { wall: 'right', u: -1.5, w: 0.36, h: 0.5, sill: 0.85 },
    { wall: 'right', u: 1.1, w: 0.36, h: 0.5, sill: 0.85 },
  ],
  library: [
    { wall: 'front', u: -2.0, w: 0.34, h: 0.45, sill: 0.775 },
    { wall: 'front', u: 2.0, w: 0.34, h: 0.45, sill: 0.775 },
    { wall: 'back', u: -1.8, w: 0.34, h: 0.45, sill: 0.775 },
    { wall: 'back', u: 1.8, w: 0.34, h: 0.45, sill: 0.775 },
    { wall: 'left', u: -1.4, w: 0.34, h: 0.45, sill: 0.775 },
    { wall: 'left', u: 1.0, w: 0.34, h: 0.45, sill: 0.775 },
    { wall: 'right', u: -1.4, w: 0.34, h: 0.45, sill: 0.775 },
    { wall: 'right', u: 1.0, w: 0.34, h: 0.45, sill: 0.775 },
  ],
  tower: [
    { wall: 'seg1', u: 0, w: 0.3, h: 0.45, sill: 0.55 },
    { wall: 'seg4', u: 0, w: 0.3, h: 0.45, sill: 0.55 },
    { wall: 'seg7', u: 0, w: 0.3, h: 0.45, sill: 0.55 },
    { wall: 'seg10', u: 0, w: 0.3, h: 0.45, sill: 0.55 },
  ],
  temple: [],
};

export interface WallHole {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Czy dwa otwory na tej samej ścianie nachodzą na siebie (z zapasem 2 cm). */
export function holesOverlap(a: WallHole, b: WallHole): boolean {
  return a.u0 < b.u1 + 0.02 && b.u0 < a.u1 + 0.02 && a.v0 < b.v1 + 0.02 && b.v0 < a.v1 + 0.02;
}

/**
 * Otwory okien wbudowanych na każdym piętrze budynku (jednostki modelu) — bez tych, które nachodzą na otwory
 * postawione przez użytkownika (`user`): elewacja z biblioteki ma pierwszeństwo.
 */
export function shellWindowHoles(type: string, floors: number, user: Record<string, WallHole[]> = {}): Record<string, (WallHole & { win: ShellWindow; floor: number })[]> {
  const spec = SHELLS[type];
  const out: Record<string, (WallHole & { win: ShellWindow; floor: number })[]> = {};
  if (!spec) return out;
  for (let k = 0; k < Math.max(1, floors); k++) {
    for (const win of SHELL_WINDOWS[type] ?? []) {
      const v0 = spec.floorY + k * spec.inner.h + win.sill;
      const hole = { u0: win.u - win.w / 2, u1: win.u + win.w / 2, v0, v1: v0 + win.h };
      if ((user[win.wall] ?? []).some((h) => holesOverlap(h, hole))) continue;
      (out[win.wall] ??= []).push({ ...hole, win, floor: k });
    }
  }
  return out;
}

/** Współrzędna `u` punktu lokalnego wzdłuż ściany. Środek ściany ma `u = 0` w układzie `wallGeometry` (x albo z modelu). */
function wallU(wall: FacadeWall, lx: number, lz: number): number {
  return lx * wall.tx + lz * wall.tz - (wall.tx * wall.cx + wall.tz * wall.cz);
}

export interface FacadeHit {
  wall: FacadeWall;
  u: number;
  x: number;
  z: number;
  yaw: number;
}

/**
 * Miejsce na elewacji dla punktu świata (x, z): najbliższa ściana budynku, do której lico jest bliżej niż
 * 0,8 m, `u` przycięte tak, by otwór mieścił się w ścianie. Zwraca punkt na licu i obrót na zewnątrz.
 */
export function facadeSnap(b: PalaceObject, type: string, x: number, z: number): FacadeHit | null {
  const spec = FACADE[type];
  if (!spec || !isInPlace(b)) return null;
  const [lx, lz] = localXZ(b, x, z);
  const su = b.type === 'tower' ? b.scale[0] : b.scale[0];
  let best: { wall: FacadeWall; u: number; d: number } | null = null;
  for (const wall of facadeWalls(b)) {
    const d = Math.abs((lx - wall.cx) * wall.nx + (lz - wall.cz) * wall.nz) * Math.max(b.scale[0], b.scale[2]);
    if (d > 0.8) continue;
    const alongScale = Math.abs(wall.nx) > 0.5 ? b.scale[2] : su; // ściany boczne biegną wzdłuż Z
    const halfW = spec.w / 2 / alongScale;
    const limit = wall.half - halfW - 0.02;
    if (limit <= 0) continue;
    const u = Math.max(-limit, Math.min(limit, wallU(wall, lx, lz)));
    if (!best || d < best.d) best = { wall, u, d };
  }
  if (!best) return null;
  const { wall, u } = best;
  // punkt na licu: środek ściany plus `u` wzdłuż jej osi (ściany pudełka mają 0 na osi biegu, więc wzór jest wspólny)
  const px = wall.cx + wall.tx * u;
  const pz = wall.cz + wall.tz * u;
  // lokalne → świat: skala, obrót wokół Y, przesunięcie
  const c = Math.cos(b.rotation[1]);
  const sn = Math.sin(b.rotation[1]);
  const sx = px * b.scale[0];
  const sz = pz * b.scale[2];
  const wx = b.position[0] + sx * c + sz * sn;
  const wz = b.position[2] - sx * sn + sz * c;
  const nwx = wall.nx * c + wall.nz * sn;
  const nwz = -wall.nx * sn + wall.nz * c;
  return { wall, u: Math.round(u * 100) / 100, x: wx, z: wz, yaw: Math.atan2(nwx, nwz) };
}

/** Czy typ elewacji wolno postawić na tym piętrze. */
export function facadeFloorOk(type: string, floor: number): boolean {
  const spec = FACADE[type];
  return !!spec && floor >= spec.minFloor && floor <= spec.maxFloor;
}

/** Otwory elewacji na ścianach budynku z pozycji obiektów w nim zakotwiczonych (jednostki lokalne modelu). */
export function facadeHoles(b: PalaceObject, objects: PalaceObject[]): Record<string, { u0: number; u1: number; v0: number; v1: number }[]> {
  const out: Record<string, { u0: number; u1: number; v0: number; v1: number }[]> = {};
  const shell = SHELLS[b.type];
  if (!shell) return out;
  for (const o of objects) {
    if (!isFacade(o.type) || o.anchorId !== b.id) continue;
    const hit = facadeSnap(b, o.type, o.position[0], o.position[2]);
    if (!hit) continue;
    const spec = FACADE[o.type];
    const floor = floorOfIn(b, o.position[1]);
    if (!facadeFloorOk(o.type, floor)) continue;
    const alongScale = Math.abs(hit.wall.nx) > 0.5 ? b.scale[2] : b.scale[0];
    const halfW = spec.w / 2 / alongScale;
    const v0 = shell.floorY + floor * shell.inner.h + spec.sill / b.scale[1];
    const v1 = v0 + spec.h / b.scale[1];
    (out[hit.wall.key] ??= []).push({ u0: hit.u - halfW, u1: hit.u + halfW, v0, v1 });
  }
  return out;
}

/** Czy miejsce na ścianie jest wolne od innych elementów elewacji na tym samym piętrze. */
export function facadeSlotFree(b: PalaceObject, objects: PalaceObject[], hit: FacadeHit, type: string, floor: number, ignoreId?: string): boolean {
  const w = FACADE[type].w;
  const along = Math.abs(hit.wall.nx) > 0.5 ? b.scale[2] : b.scale[0];
  // okna wbudowane w mur zajmują miejsce jak elewacja z biblioteki
  for (const win of SHELL_WINDOWS[b.type] ?? []) {
    if (win.wall !== hit.wall.key) continue;
    if (Math.abs(win.u - hit.u) * along < (w + win.w * along) / 2 + 0.3) return false;
  }
  for (const o of objects) {
    if (!isFacade(o.type) || o.anchorId !== b.id || o.id === ignoreId) continue;
    if (floorOfIn(b, o.position[1]) !== floor) continue;
    const h = facadeSnap(b, o.type, o.position[0], o.position[2]);
    if (!h || h.wall.key !== hit.wall.key) continue;
    const alongScale = Math.abs(hit.wall.nx) > 0.5 ? b.scale[2] : b.scale[0];
    if (Math.abs(h.u - hit.u) * alongScale < (w + FACADE[o.type].w) / 2 + 0.3) return false;
  }
  return true;
}
