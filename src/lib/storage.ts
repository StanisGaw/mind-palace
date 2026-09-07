import type { AppData, GroundSpec, Palace, PalaceSettings, RoomSpec, Vec3 } from '../types';
import { uid } from './ids';
import { hashString } from '../three/noise';

const KEY = 'mneme.data.v1';

export function defaultSettings(): PalaceSettings {
  return { grid: true, showPath: true, ground: { width: 24, depth: 24, shape: 'rect' }, ambience: 'garden', weather: 'clear', scenery: 'meadow', seed: (Math.random() * 1e9) | 0 };
}

export function makePalace(name = 'Ogród dobrych myśli'): Palace {
  const now = Date.now();
  return { id: uid('p'), name, createdAt: now, updatedAt: now, objects: [], path: [], settings: defaultSettings() };
}

/** Nowe wnętrze budynku: własna scena bez terenu, pogody i siatki. */
export function makeInteriorPalace(name: string, buildingType: string, spec: RoomSpec, parentId: string, parentObjectId: string): Palace {
  const p = makePalace(name);
  p.parentId = parentId;
  p.parentObjectId = parentObjectId;
  p.interior = { buildingType };
  p.settings = { ...p.settings, grid: false, scenery: 'none', weather: 'clear', ground: { width: spec.width, depth: spec.depth, shape: 'rect' } };
  return p;
}

export function loadData(): AppData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppData;
    const version = (parsed as unknown as { version?: number })?.version;
    if (!parsed || (version !== 1 && version !== 2) || !Array.isArray(parsed.palaces) || parsed.palaces.length === 0) return null;
    return normalizeData({ version: 2, currentId: parsed.currentId, palaces: parsed.palaces.map(normalizePalace) });
  } catch {
    return null;
  }
}

/** Naprawia powiązania między pałacami: osierocone wnętrza stają się samodzielne, martwe odsyłacze znikają. */
export function normalizeData(data: AppData): AppData {
  const byId = new Map(data.palaces.map((p) => [p.id, p]));
  for (const p of data.palaces) {
    if (p.parentId && !byId.has(p.parentId)) {
      delete p.parentId;
      delete p.parentObjectId;
      delete p.interior;
    }
    const objIds = new Set(p.objects.map((o) => o.id));
    for (const o of p.objects) {
      if (o.anchorId && (!objIds.has(o.anchorId) || o.anchorId === o.id)) delete o.anchorId;
      if (!o.interiorId) continue;
      const inside = byId.get(o.interiorId);
      if (!inside || inside.parentObjectId !== o.id) delete o.interiorId;
    }
    // łańcuch kotwic nie może tworzyć cyklu
    for (const o of p.objects) {
      const seen = new Set<string>([o.id]);
      let cur = o.anchorId ? p.objects.find((x) => x.id === o.anchorId) : undefined;
      while (cur) {
        if (seen.has(cur.id)) {
          delete o.anchorId;
          break;
        }
        seen.add(cur.id);
        cur = cur.anchorId ? p.objects.find((x) => x.id === cur!.anchorId) : undefined;
      }
    }
  }
  // cykle: wnętrze nie może być swoim przodkiem
  for (const p of data.palaces) {
    const seen = new Set<string>([p.id]);
    let cur = p.parentId ? byId.get(p.parentId) : undefined;
    while (cur) {
      if (seen.has(cur.id)) {
        delete p.parentId;
        delete p.parentObjectId;
        delete p.interior;
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  const currentId = byId.has(data.currentId) ? data.currentId : (data.palaces.find((p) => !p.parentId) ?? data.palaces[0]).id;
  return { version: 2, currentId, palaces: data.palaces };
}

export function saveData(data: AppData) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

/** Skala mogła być zapisana jako liczba (starsze wersje) albo wektor. */
function toScale(s: unknown): Vec3 {
  if (typeof s === 'number' && Number.isFinite(s) && s > 0) return [s, s, s];
  if (Array.isArray(s) && s.length === 3) {
    const v = s.map((n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 1));
    return [v[0], v[1], v[2]];
  }
  return [1, 1, 1];
}

export function normalizePalace(p: Partial<Palace>): Palace {
  const base = makePalace(p.name ?? 'Pałac');
  const objects = Array.isArray(p.objects) ? p.objects : [];
  const ids = new Set(objects.map((o) => o.id));
  return {
    ...base,
    ...p,
    id: p.id ?? base.id,
    objects: objects.map((o) => ({
      ...o,
      position: (o.position ?? [0, 0, 0]) as Palace['objects'][number]['position'],
      rotationY: o.rotationY ?? 0,
      scale: toScale((o as { scale?: unknown }).scale),
    })),
    path: Array.isArray(p.path) ? p.path.filter((id) => ids.has(id)) : [],
    // ziarno starych pałaców wyliczamy z id, żeby teren nie zmieniał się przy każdym otwarciu
    settings: normalizeSettings(p.settings, p.id ?? base.id),
  };
}

/** Uzupełnia ustawienia i przenosi stary `groundSize` na opis kształtu planszy. */
function normalizeSettings(raw: unknown, id: string): PalaceSettings {
  const src = (raw ?? {}) as Partial<PalaceSettings> & { groundSize?: number };
  const merged: PalaceSettings & { groundSize?: number } = { ...defaultSettings(), seed: hashString(id), ...src };
  // patrzymy na zapisane dane, nie na scalone domyślne wartości
  const g = src.ground as Partial<GroundSpec> | undefined;
  if (!g || typeof g.width !== 'number') {
    const size = typeof src.groundSize === 'number' && src.groundSize > 0 ? src.groundSize : 24;
    merged.ground = { width: size, depth: size, shape: 'rect' };
  } else {
    merged.ground = {
      width: Math.max(4, g.width),
      depth: Math.max(4, typeof g.depth === 'number' ? g.depth : g.width),
      shape: g.shape === 'circle' || g.shape === 'hex' ? g.shape : 'rect',
    };
  }
  delete merged.groundSize;
  return merged;
}

/** Korzeń drzewa, do którego należy dany pałac. */
export function rootOf(id: string, palaces: Palace[]): Palace {
  const byId = new Map(palaces.map((p) => [p.id, p]));
  let cur = byId.get(id) ?? palaces[0];
  const seen = new Set<string>();
  while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId)!;
  }
  return cur;
}

/** Ścieżka od korzenia do wskazanego pałacu (do okruszków nawigacji). */
export function chainOf(id: string, palaces: Palace[]): Palace[] {
  const byId = new Map(palaces.map((p) => [p.id, p]));
  const out: Palace[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Wszystkie wnętrza pod danym pałacem (bez niego samego). */
export function collectSubtree(rootId: string, palaces: Palace[]): Palace[] {
  const out: Palace[] = [];
  const queue = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length) {
    const id = queue.shift()!;
    for (const p of palaces) {
      if (p.parentId === id && !seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
        queue.push(p.id);
      }
    }
  }
  return out;
}

/** Eksport całego drzewa: pałac + wszystkie jego wnętrza. */
export function exportPalaceJson(root: Palace, all: Palace[]): string {
  return JSON.stringify({ app: 'mneme', version: 2, palace: root, interiors: collectSubtree(root.id, all) }, null, 2);
}

/** Nadaje nowe identyfikatory pałacom i przepina odsyłacze, żeby import nigdy nie nadpisał istniejących danych. */
export function remapIds(palaces: Palace[]): Palace[] {
  const map = new Map<string, string>();
  for (const p of palaces) map.set(p.id, uid('p'));
  return palaces.map((p) => ({
    ...p,
    id: map.get(p.id)!,
    parentId: p.parentId ? map.get(p.parentId) ?? undefined : undefined,
    objects: p.objects.map((o) => ({ ...o, interiorId: o.interiorId ? map.get(o.interiorId) ?? undefined : undefined })),
  }));
}

export function parseImport(text: string): Palace[] {
  const parsed = JSON.parse(text);
  let list: Palace[] | null = null;
  if (parsed && parsed.app === 'mneme' && parsed.palace) {
    list = [normalizePalace(parsed.palace), ...(Array.isArray(parsed.interiors) ? parsed.interiors.map(normalizePalace) : [])];
  } else if (parsed && Array.isArray(parsed.palaces)) {
    list = parsed.palaces.map(normalizePalace);
  } else if (parsed && Array.isArray(parsed.objects)) {
    list = [normalizePalace(parsed)];
  }
  if (!list || list.length === 0) throw new Error('Nieznany format pliku');
  const fixed = normalizeData({ version: 2, currentId: list[0].id, palaces: remapIds(list) });
  return fixed.palaces;
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
