import type { Palace } from '../types';
import { isDue } from './srs';

export interface ReviewStop {
  palaceId: string;
  objectId: string;
  depth: number; // 0 = scena główna, 1 = wnętrze, 2 = wnętrze we wnętrzu…
}

/**
 * Spłaszcza trasę spaceru: kolejność ze ścieżki pamięci, a zaraz po przystanku-budynku
 * odwiedzamy całe jego wnętrze i wracamy na zewnątrz.
 */
export function flattenStops(rootId: string, palaces: Palace[], onlyDue = false, now = Date.now()): ReviewStop[] {
  const byId = new Map(palaces.map((p) => [p.id, p]));
  const out: ReviewStop[] = [];
  const visited = new Set<string>();

  const walk = (palaceId: string, depth: number) => {
    const p = byId.get(palaceId);
    if (!p || visited.has(palaceId) || depth > 8) return;
    visited.add(palaceId);
    // najpierw obiekty ze ścieżki, potem pozostałe (żeby nic nie zginęło)
    const ordered = [...p.path.filter((id) => p.objects.some((o) => o.id === id)), ...p.objects.map((o) => o.id).filter((id) => !p.path.includes(id))];
    for (const id of ordered) {
      const o = p.objects.find((x) => x.id === id);
      if (!o) continue;
      if (o.note && (!onlyDue || isDue(o.note.srs, now))) out.push({ palaceId, objectId: id, depth });
      if (o.interiorId && byId.has(o.interiorId)) walk(o.interiorId, depth + 1);
    }
  };

  walk(rootId, 0);
  return out;
}

/** Liczba notatek czekających na powtórkę w całym drzewie pałacu. */
export function dueInTree(rootId: string, palaces: Palace[], now = Date.now()): number {
  return flattenStops(rootId, palaces, true, now).length;
}
