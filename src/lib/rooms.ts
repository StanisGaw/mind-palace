import { ROOMS } from '../catalog';
import type { Palace, PalaceObject, RoomSpec } from '../types';

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
