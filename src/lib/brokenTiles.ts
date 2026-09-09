import type { BrokenTile, Palace, PalaceObject, Vec3 } from '../types';

/** Promień, w jakim zapisujemy sąsiadów zgłoszenia — tyle zwykle wystarcza, żeby wskazać winną bryłę. */
export const NEIGHBOUR_RADIUS = 6;
const NEIGHBOUR_LIMIT = 12;

/** Kafel siatki metrowej, w którym leży punkt. */
export function gridTileAt(x: number, z: number): [number, number] {
  return [Math.floor(x), Math.floor(z)];
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Zgłoszenie dla klikniętego punktu razem z migawką najbliższych obiektów. Sąsiadów zapisujemy od razu,
 * bo obiekt, który stawia niewidzialną ścianę, może zostać przesunięty zanim ktoś zajrzy do zgłoszenia.
 */
export function makeBrokenTile(point: Vec3, objects: PalaceObject[], id: string, now = Date.now()): BrokenTile {
  const nearby = objects
    .map((o) => ({ o, distance: Math.hypot(o.position[0] - point[0], o.position[2] - point[2]) }))
    .filter((n) => n.distance <= NEIGHBOUR_RADIUS)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEIGHBOUR_LIMIT)
    .map(({ o, distance }) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      position: o.position.map(round) as Vec3,
      rotationY: round(o.rotation[1]),
      scale: o.scale.map(round) as Vec3,
      distance: round(distance),
    }));
  return { id, point: point.map(round) as Vec3, tile: gridTileAt(point[0], point[2]), createdAt: now, nearby };
}

/** Czy zgłoszenie z zapisu ma wszystko, czego wymaga kod — starsze albo ręcznie edytowane wpisy odrzucamy. */
export function isBrokenTile(raw: unknown): raw is BrokenTile {
  const t = raw as Partial<BrokenTile> | null;
  return !!t && typeof t.id === 'string' && Array.isArray(t.point) && t.point.length === 3 && t.point.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Krótki opis do listy i toastu: „kafel (5, −6)". */
export function describeBrokenTile(t: BrokenTile): string {
  const fmt = (v: number) => (v < 0 ? `−${-v}` : `${v}`);
  return `kafel (${fmt(t.tile[0])}, ${fmt(t.tile[1])})`;
}

/** Tekst do schowka: zgłoszenie z nazwą pałacu, gotowe do wklejenia do rozmowy albo zgłoszenia błędu. */
export function brokenTileText(palace: Pick<Palace, 'id' | 'name' | 'interior'>, t: BrokenTile): string {
  return JSON.stringify(
    {
      palace: { id: palace.id, name: palace.name, interior: palace.interior?.buildingType },
      brokenTile: t,
    },
    null,
    2,
  );
}
