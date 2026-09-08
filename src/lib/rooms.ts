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
