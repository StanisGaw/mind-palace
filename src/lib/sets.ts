import { yawRotation } from './transform';
import { uid } from './ids';
import { ROOMS, catalogItem } from '../catalog';
import { WALL_SEGMENT } from './rooms';
import type { FurnitureSet, PalaceObject, SetObject, Vec3 } from '../types';

/**
 * Zestawy mebli: nazwane grupy o stałych wymiarach w metrach, jednakowe dla każdego rodzaju budynku.
 * Użytkownik sam wydziela strefy — stawia salon tu, kuchnię tam, gabinet na piętrze. Punkt wstawienia
 * to środek obrysu `width × depth`; zestaw z `back` ma tył przy krawędzi −Z, do przystawienia do ściany.
 */
/** Szczelina między tyłem zestawu a ścianą: mebel dokładnie na linii muru liczy się jako wystający. */
export const SET_WALL_GAP = 0.08;

export const FURNITURE_SETS: FurnitureSet[] = [
  {
    id: 'salon',
    name: 'Salon',
    description: 'Sofa i fotele przy kominku, stolik na środku, obraz nad ogniem.',
    width: 4.6,
    depth: 3.6,
    back: true,
    objects: [
      { type: 'fireplace', dx: 0, dz: -1.5, rotationY: 0 },
      { type: 'painting', dx: 0, dz: -1.72, rotationY: 0 },
      { type: 'clock', dx: 1.9, dz: -1.64, rotationY: 0 },
      { type: 'sofa', dx: 0, dz: 1.0, rotationY: Math.PI },
      { type: 'armchair', dx: -1.7, dz: 0, rotationY: Math.PI / 2 },
      { type: 'armchair', dx: 1.7, dz: 0, rotationY: -Math.PI / 2 },
      { type: 'table', dx: 0, dz: 0, rotationY: 0, scale: [0.7, 0.7, 0.7] },
      { type: 'rug', dx: 0, dz: 0.1, rotationY: 0, scale: [1.8, 1, 1.2] },
      { type: 'ceiling_lamp', dx: 0, dz: 0, rotationY: 0 },
    ],
  },
  {
    id: 'kuchnia',
    name: 'Kuchnia',
    description: 'Piec i szafki z blatem pod ścianą, kredens i regał na zapasy.',
    width: 4.2,
    depth: 3.0,
    back: true,
    objects: [
      { type: 'counter', dx: -1.3, dz: -1.2, rotationY: 0 },
      { type: 'counter', dx: 0, dz: -1.2, rotationY: 0 },
      { type: 'stove', dx: 1.0, dz: -1.2, rotationY: 0 },
      { type: 'dishes', dx: 0, dz: -1.2, dy: 0.92, rotationY: 0.3, anchor: 1 },
      { type: 'sideboard', dx: 1.7, dz: 0.3, rotationY: -Math.PI / 2 },
      { type: 'shelf', dx: -1.9, dz: 0.2, rotationY: Math.PI / 2 },
      { type: 'ceiling_lamp', dx: 0, dz: -0.3, rotationY: 0 },
    ],
  },
  {
    id: 'jadalnia',
    name: 'Jadalnia',
    description: 'Stół z sześcioma krzesłami, kredens z naczyniami, dywan pod całością.',
    width: 3.4,
    depth: 3.6,
    back: true,
    objects: [
      { type: 'sideboard', dx: 0, dz: -1.53, rotationY: 0 },
      { type: 'dishes', dx: 0, dz: -1.53, dy: 0.94, rotationY: 0, anchor: 0 },
      { type: 'painting', dx: 0, dz: -1.72, rotationY: 0 },
      { type: 'table', dx: 0, dz: 0.4, rotationY: 0 },
      { type: 'chair', dx: -0.55, dz: -0.38, rotationY: 0 },
      { type: 'chair', dx: 0.55, dz: -0.38, rotationY: 0 },
      { type: 'chair', dx: -0.55, dz: 1.18, rotationY: Math.PI },
      { type: 'chair', dx: 0.55, dz: 1.18, rotationY: Math.PI },
      { type: 'chair', dx: -1.15, dz: 0.4, rotationY: Math.PI / 2 },
      { type: 'chair', dx: 1.15, dz: 0.4, rotationY: -Math.PI / 2 },
      { type: 'rug', dx: 0, dz: 0.4, rotationY: 0, scale: [1.8, 1, 1.6] },
      { type: 'ceiling_lamp', dx: 0, dz: 0.4, rotationY: 0 },
    ],
  },
  {
    id: 'sypialnia',
    name: 'Sypialnia',
    description: 'Łóżko pod ścianą, kredens z wazonem, lustro i skrzynia w nogach.',
    width: 4.0,
    depth: 4.2,
    back: true,
    objects: [
      { type: 'bed', dx: -0.6, dz: -1.05, rotationY: 0 },
      { type: 'painting', dx: -0.6, dz: -2.02, rotationY: 0 },
      { type: 'sideboard', dx: 1.25, dz: -1.83, rotationY: 0 },
      { type: 'vase', dx: 1.25, dz: -1.83, dy: 0.94, rotationY: 0, anchor: 2 },
      { type: 'mirror', dx: 1.25, dz: -2.02, rotationY: 0 },
      { type: 'curtains', dx: -1.7, dz: -2.02, rotationY: 0 },
      { type: 'chest', dx: -0.6, dz: 0.45, rotationY: 0 },
      { type: 'rug', dx: 0.6, dz: 0.6, rotationY: 0, scale: [1.2, 1, 1.2] },
      { type: 'ceiling_lamp', dx: 0, dz: -0.5, rotationY: 0 },
    ],
  },
  {
    id: 'gabinet',
    name: 'Gabinet',
    description: 'Biurko z krzesłem, regały pod ścianą, zegar i popiersie. Blat zostaje pusty.',
    width: 4.2,
    depth: 3.4,
    back: true,
    objects: [
      { type: 'desk', dx: 0, dz: -1.35, rotationY: 0 },
      { type: 'chair', dx: 0, dz: -0.65, rotationY: Math.PI },
      { type: 'shelf', dx: -1.75, dz: -0.6, rotationY: Math.PI / 2 },
      { type: 'shelf', dx: -1.75, dz: 0.9, rotationY: Math.PI / 2 },
      { type: 'clock', dx: 1.6, dz: -1.54, rotationY: 0 },
      { type: 'bust', dx: 1.75, dz: 0.3, rotationY: -Math.PI / 2 },
      { type: 'rug', dx: 0, dz: 0.3, rotationY: 0, scale: [1.4, 1, 1.2] },
      { type: 'ceiling_lamp', dx: 0, dz: -0.4, rotationY: 0 },
    ],
  },
  {
    id: 'czytelnia',
    name: 'Kącik czytelniczy',
    description: 'Trzy regały, fotel przy stoliku i globus pod ręką.',
    width: 3.8,
    depth: 3.2,
    back: true,
    objects: [
      { type: 'shelf', dx: -1.0, dz: -1.4, rotationY: 0 },
      { type: 'shelf', dx: 1.0, dz: -1.4, rotationY: 0 },
      { type: 'shelf', dx: -1.7, dz: 0.2, rotationY: Math.PI / 2 },
      { type: 'armchair', dx: 0.4, dz: 0.3, rotationY: Math.PI },
      { type: 'table', dx: 0.4, dz: -0.7, rotationY: 0, scale: [0.6, 1, 0.7] },
      { type: 'globe', dx: 0.4, dz: -0.7, dy: 0.81, rotationY: 0, anchor: 4 },
      { type: 'ceiling_lamp', dx: 0, dz: 0, rotationY: 0 },
    ],
  },
  {
    id: 'ogrod',
    name: 'Ogród',
    description: 'Fontanna, ławka naprzeciw, drzewa i rabaty dookoła. Tylko na planszy.',
    width: 7.0,
    depth: 6.0,
    outdoor: true,
    objects: [
      { type: 'fountain', dx: 0, dz: -1.0, rotationY: 0 },
      { type: 'bench', dx: 0, dz: 1.4, rotationY: Math.PI },
      { type: 'flowers', dx: -2.2, dz: -0.4, rotationY: 0 },
      { type: 'flowers', dx: 2.2, dz: -0.4, rotationY: 0 },
      { type: 'bush', dx: -1.6, dz: 1.6, rotationY: 0 },
      { type: 'bush', dx: 1.6, dz: 1.6, rotationY: 0 },
      { type: 'tree', dx: -2.6, dz: -2.0, rotationY: 0 },
      { type: 'tree', dx: 2.6, dz: -2.0, rotationY: 0 },
      { type: 'lantern', dx: 0, dz: 2.4, rotationY: 0 },
    ],
  },
];

export function furnitureSet(id: string, custom: FurnitureSet[] = []): FurnitureSet | undefined {
  return [...FURNITURE_SETS, ...custom].find((s) => s.id === id);
}

/**
 * Zestaw jako obiekty pałacu wokół zera: pozycje w metrach, wspólna grupa, kotwice wewnątrz zestawu.
 * Wołający przenosi je w miejsce wstawienia (`store.placeObjectsAt`).
 */
export function instantiateSet(set: FurnitureSet, makeId: () => string = uid): PalaceObject[] {
  const ids = set.objects.map(() => makeId());
  const groupId = makeId();
  return set.objects.map((so, i) => {
    const item = catalogItem(so.type);
    let scale: Vec3 = so.scale ?? [1, 1, 1];
    if (so.length !== undefined) scale = [so.length / WALL_SEGMENT, scale[1], scale[2]];
    return {
      id: ids[i],
      type: so.type,
      name: so.name ?? item.name,
      position: [so.dx, so.dy ?? 0, so.dz] as Vec3,
      rotation: yawRotation(so.rotationY),
      scale,
      anchorId: so.anchor !== undefined && so.anchor !== i ? ids[so.anchor] : undefined,
      groupId,
      ...(so.colors ? { colors: so.colors } : {}),
      ...(so.finish ? { finish: so.finish } : {}),
    };
  });
}

/** Zaznaczenie jako zestaw do zapisania: pozycje względem środka obrysu, kotwice na indeksy. */
export function captureSet(name: string, objects: PalaceObject[]): FurnitureSet {
  const indexOf = new Map(objects.map((o, i) => [o.id, i]));
  const xs = objects.map((o) => o.position[0]);
  const zs = objects.map((o) => o.position[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const baseY = Math.min(...objects.map((o) => o.position[1]));
  const setObjects: SetObject[] = objects.map((o) => {
    const so: SetObject = { type: o.type, dx: o.position[0] - cx, dz: o.position[2] - cz, rotationY: o.rotation[1] };
    // własna nazwa niesie skojarzenie, a kolory i wykończenie decydują o wyglądzie — zestaw ma je zachować
    if (o.name && o.name !== catalogItem(o.type).name) so.name = o.name;
    if (o.colors && Object.keys(o.colors).length > 0) so.colors = { ...o.colors };
    if (o.finish && Object.keys(o.finish).length > 0) so.finish = { ...o.finish };
    const dy = o.position[1] - baseY;
    if (Math.abs(dy) > 0.001) so.dy = dy;
    const anchor = o.anchorId ? indexOf.get(o.anchorId) : undefined;
    if (anchor !== undefined) so.anchor = anchor;
    if (o.type === 'wall' || o.type === 'pathway') so.length = o.scale[0] * WALL_SEGMENT;
    else if (o.scale[0] !== 1 || o.scale[1] !== 1 || o.scale[2] !== 1) so.scale = o.scale;
    return so;
  });
  return {
    id: uid('fs'),
    name,
    description: '',
    width: Math.max(...xs) - Math.min(...xs) + 1,
    depth: Math.max(...zs) - Math.min(...zs) + 1,
    objects: setObjects,
    custom: true,
  };
}

/** Stary układ pokoju (`u`, `v` jako ułamki wymiarów) jako zestaw w metrach. Rozpoznanie po polu `u`. */
export function setFromLegacyPreset(p: Record<string, unknown>): FurnitureSet {
  const list = (p.objects ?? []) as Record<string, unknown>[];
  const types = (p.buildingTypes as string[] | undefined) ?? [];
  const room = ROOMS[types[0] ?? 'house'] ?? ROOMS.house;
  const objects: SetObject[] = list.map((po) => {
    const span = po.span as { axis: 'x' | 'z'; frac: number } | undefined;
    const so: SetObject = {
      type: String(po.type),
      dx: Number(po.u ?? 0) * room.width + Number(po.dx ?? 0),
      dz: Number(po.v ?? 0) * room.depth + Number(po.dz ?? 0),
      rotationY: Number(po.rotationY ?? 0),
    };
    if (po.name !== undefined) so.name = String(po.name);
    // dawne piętra układu zamieniamy na wysokość — zestaw stawia się w całości na jednym poziomie
    const floorY = Number(po.floor ?? 0) * room.height + Number(po.dy ?? 0);
    if (Math.abs(floorY) > 0.001) so.dy = floorY;
    if (po.anchor !== undefined) so.anchor = Number(po.anchor);
    if (span) so.length = span.frac * (span.axis === 'x' ? room.width : room.depth);
    else if (po.scale) so.scale = po.scale as Vec3;
    return so;
  });
  const xs = objects.map((o) => o.dx);
  const zs = objects.map((o) => o.dz);
  return {
    id: String(p.id ?? uid('fs')),
    name: String(p.name ?? 'Zestaw'),
    description: String(p.description ?? ''),
    width: objects.length ? Math.max(...xs) - Math.min(...xs) + 1 : room.width,
    depth: objects.length ? Math.max(...zs) - Math.min(...zs) + 1 : room.depth,
    objects,
    custom: true,
  };
}

/** Czy wpis pochodzi jeszcze ze starego formatu układów pokoi. */
export function isLegacyPreset(p: unknown): boolean {
  const o = p as { objects?: unknown[] } | null;
  return !!o && Array.isArray(o.objects) && o.objects.length > 0 && typeof (o.objects[0] as { u?: unknown }).u === 'number';
}
