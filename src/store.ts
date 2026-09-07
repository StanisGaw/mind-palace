import { create } from 'zustand';
import type { AppData, CameraKind, Palace, PalaceObject, Rating, SoundLevels, Tool, Vec3, ViewMode } from './types';
import { ROOMS, catalogItem, hasInterior } from './catalog';
import { uid } from './lib/ids';
import { getPref, setPref } from './lib/prefs';
import { chainOf, collectSubtree, loadData, makeInteriorPalace, makePalace, rootOf, saveData } from './lib/storage';
import { isDue, newSrs, reviewSrs } from './lib/srs';
import { flattenStops, dueInTree, type ReviewStop } from './lib/review';

interface Snapshot {
  objects: PalaceObject[];
  path: string[];
}

export interface ReviewSession {
  stops: ReviewStop[];
  index: number;
  revealed: boolean;
  results: Record<string, Rating>;
  finished: boolean;
  rootId: string;
}

export interface FlyRequest {
  objectId: string;
  seq: number;
}

interface State {
  data: AppData;
  selectedId: string | null;
  hoverId: string | null;
  tool: Tool;
  viewMode: ViewMode;
  leftTab: 'library' | 'scene';
  saved: boolean;
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  review: ReviewSession | null;
  fly: FlyRequest | null;
  vrActive: boolean;
  toast: string | null;
  focusRequest: number; // licznik: dopasuj kamerę do sceny
  cameraCmd: { kind: CameraKind; seq: number } | null;
  topView: boolean; // aktywny rzut z góry na całą planszę
  sceneEntry: { kind: 'enter' | 'exit'; objectId: string; seq: number } | null;
  doorPrompt: { kind: 'enter' | 'exit'; objectId?: string; label: string } | null;
  placing: { type: string } | null; // element wybrany z biblioteki, czeka na kliknięcie w scenie
  sound: SoundLevels; // głośność dźwięków otoczenia; trzymana w preferencjach, nie w danych pałacu

  palace(): Palace;
  setPalace(mut: (p: Palace) => void, opts?: { undo?: boolean }): void;
  mutatePalace(id: string, mut: (p: Palace) => void, opts?: { undo?: boolean }): void;
  // wnętrza
  rootPalaces(): Palace[];
  breadcrumb(): Palace[];
  enterInterior(objectId: string): void;
  exitInterior(): void;
  setDoorPrompt(p: State['doorPrompt']): void;
  // obiekty
  addObject(type: string, position?: Vec3, rotationY?: number, anchorId?: string): string;
  dropToGround(id: string): void;
  setPlacing(p: { type: string } | null): void;
  removeObject(id: string): void;
  updateObject(id: string, patch: Partial<PalaceObject>, opts?: { undo?: boolean }): void;
  duplicateObject(id: string): void;
  select(id: string | null): void;
  setHover(id: string | null): void;
  setTool(t: Tool): void;
  setViewMode(v: ViewMode): void;
  setLeftTab(t: 'library' | 'scene'): void;
  // notatki
  setNote(id: string, title: string, body: string): void;
  clearNote(id: string): void;
  // ścieżka
  togglePath(id: string): void;
  movePath(id: string, dir: -1 | 1): void;
  // pałace
  createPalace(name?: string): void;
  switchPalace(id: string): void;
  renamePalace(name: string): void;
  deletePalace(id: string): void;
  importPalaces(palaces: Palace[]): void;
  setSettings(patch: Partial<Palace['settings']>): void;
  // historia
  pushUndo(): void;
  undo(): void;
  redo(): void;
  // powtórki
  startReview(onlyDue?: boolean): void;
  reveal(): void;
  rate(r: Rating): void;
  nextStop(): void;
  prevStop(): void;
  endReview(): void;
  goToStop(stop: ReviewStop): void;
  flyTo(objectId: string): void;
  setVrActive(v: boolean): void;
  showToast(msg: string): void;
  camera(kind: CameraKind): void;
  setTopView(v: boolean): void;
  setSound(patch: Partial<SoundLevels>): void;
}

export const DEFAULT_SOUND: SoundLevels = { master: 0.8, rain: 0, storm: 0, snow: 0, wind: 0, animals: 0, crickets: 0 };

const SOUND_PREF = 'sound';

function initialSound(): SoundLevels {
  const saved = getPref<Partial<SoundLevels>>(SOUND_PREF, {});
  const out = { ...DEFAULT_SOUND };
  for (const k of Object.keys(out) as (keyof SoundLevels)[]) {
    const v = saved[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v));
  }
  return out;
}

/** Obiekty stojące (bezpośrednio i pośrednio) na wskazanym obiekcie. */
export function descendants(objects: PalaceObject[], id: string): PalaceObject[] {
  const out: PalaceObject[] = [];
  const queue = [id];
  const seen = new Set<string>([id]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const o of objects) {
      if (o.anchorId === cur && !seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
        queue.push(o.id);
      }
    }
  }
  return out;
}

function seedPalace(): Palace {
  const p = makePalace('Ogród dobrych myśli');
  const add = (type: string, name: string, position: Vec3, rotationY = 0) => {
    const o: PalaceObject = { id: uid(), type, name, position, rotationY, scale: [1, 1, 1] };
    p.objects.push(o);
    return o;
  };
  const now = Date.now();
  const note = (title: string, body: string) => ({ title, body, createdAt: now, updatedAt: now, srs: newSrs() });
  const a = add('palace', 'Pałac odkryć', [-3.5, 0, -1], 0);
  a.note = note('Cel na ten miesiąc', 'Skończyć prototyp i pokazać go trzem osobom.');
  const b = add('library', 'Biblioteka pomysłów', [3, 0, -2], -0.4);
  b.note = note('Trzy książki do przeczytania', '1. Moonwalking with Einstein\n2. Sztuka pamięci\n3. Atomic Habits');
  const c = add('fountain', 'Źródło skojarzeń', [0.2, 0, 1.2]);
  c.note = note('Zasada', 'Każde nowe pojęcie łącz z obrazem i miejscem.');
  add('tree', 'Drzewo', [-6.5, 0, 1.5]);
  add('tree', 'Drzewo', [6.8, 0, 0.5]);
  add('cypress', 'Cyprys', [-5.5, 0, -3]);
  add('cypress', 'Cyprys', [-1.2, 0, -3.2]);
  add('cypress', 'Cyprys', [5.2, 0, -3.5]);
  add('bench', 'Ławka', [-2.2, 0, 2.6], Math.PI);
  add('lantern', 'Latarnia', [2.6, 0, 2.2]);
  add('books', 'Książki', [4.2, 0, 2.6], 0.5);
  add('tree', 'Drzewo', [7.2, 0, 3]);
  p.path = [a.id, b.id, c.id];
  return p;
}

function initialData(): AppData {
  const loaded = loadData();
  if (loaded) return loaded;
  const p = seedPalace();
  return { version: 2, currentId: p.id, palaces: [p] };
}

let saveTimer: number | undefined;
function scheduleSave(get: () => State, set: (s: Partial<State>) => void) {
  set({ saved: false });
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      saveData(get().data);
      set({ saved: true });
    } catch (e) {
      console.error(e);
    }
  }, 350);
}

let toastTimer: number | undefined;
let flySeq = 0;
let camSeq = 0;
let entrySeq = 0;

export const useStore = create<State>((set, get) => ({
  data: initialData(),
  selectedId: null,
  hoverId: null,
  tool: 'select',
  viewMode: 'editor',
  leftTab: 'library',
  saved: true,
  undoStack: [],
  redoStack: [],
  review: null,
  fly: null,
  vrActive: false,
  toast: null,
  focusRequest: 0,
  cameraCmd: null,
  topView: false,
  sceneEntry: null,
  doorPrompt: null,
  placing: null,
  sound: initialSound(),

  palace() {
    const d = get().data;
    return d.palaces.find((p) => p.id === d.currentId) ?? d.palaces[0];
  },

  setPalace(mut, opts) {
    get().mutatePalace(get().data.currentId, mut, opts);
  },

  mutatePalace(id, mut, opts) {
    if (opts?.undo !== false) get().pushUndo();
    const d = get().data;
    const palaces = d.palaces.map((p) => {
      if (p.id !== id) return p;
      const copy: Palace = JSON.parse(JSON.stringify(p));
      mut(copy);
      copy.updatedAt = Date.now();
      return copy;
    });
    set({ data: { ...d, palaces } });
    scheduleSave(get, set);
  },

  rootPalaces() {
    return get().data.palaces.filter((p) => !p.parentId);
  },

  breadcrumb() {
    const d = get().data;
    return chainOf(d.currentId, d.palaces);
  },

  enterInterior(objectId) {
    const d = get().data;
    const parent = get().palace();
    const obj = parent.objects.find((o) => o.id === objectId);
    if (!obj || !hasInterior(obj.type)) return;
    let interiorId = obj.interiorId;
    let palaces = d.palaces;
    if (!interiorId || !palaces.some((p) => p.id === interiorId)) {
      const room = ROOMS[obj.type];
      const created = makeInteriorPalace(obj.name, obj.type, room, parent.id, obj.id);
      interiorId = created.id;
      palaces = palaces.map((p) => {
        if (p.id !== parent.id) return p;
        const copy: Palace = JSON.parse(JSON.stringify(p));
        const o = copy.objects.find((x) => x.id === objectId);
        if (o) o.interiorId = created.id;
        copy.updatedAt = Date.now();
        return copy;
      });
      palaces = [...palaces, created];
    }
    set({
      data: { ...d, palaces, currentId: interiorId },
      selectedId: null,
      hoverId: null,
      undoStack: [],
      redoStack: [],
      doorPrompt: null,
      sceneEntry: { kind: 'enter', objectId, seq: ++entrySeq },
    });
    scheduleSave(get, set);
  },

  exitInterior() {
    const d = get().data;
    const cur = get().palace();
    if (!cur.parentId || !d.palaces.some((p) => p.id === cur.parentId)) return;
    set({
      data: { ...d, currentId: cur.parentId },
      selectedId: null,
      hoverId: null,
      undoStack: [],
      redoStack: [],
      doorPrompt: null,
      sceneEntry: { kind: 'exit', objectId: cur.parentObjectId ?? '', seq: ++entrySeq },
    });
    scheduleSave(get, set);
  },

  setPlacing(p) {
    const cur = get().placing;
    if (cur?.type === p?.type) return;
    set({ placing: p });
  },

  setDoorPrompt(p) {
    const cur = get().doorPrompt;
    const same = (!cur && !p) || (cur && p && cur.kind === p.kind && cur.objectId === p.objectId);
    if (!same) set({ doorPrompt: p });
  },

  addObject(type, position, rotationY, anchorId) {
    const item = catalogItem(type);
    const id = uid();
    const p = get().palace();
    // obiekty unikalne (brama) nie duplikują się — przenosimy istniejący
    if (item.unique) {
      const existing = p.objects.find((o) => o.type === type);
      if (existing) {
        const pos = position ?? existing.position;
        get().updateObject(existing.id, { position: pos, rotationY: rotationY ?? (position ? Math.atan2(pos[0], pos[2]) : existing.rotationY) });
        set({ selectedId: existing.id, ...(get().placing ? {} : { leftTab: 'scene' as const }) });
        get().showToast(`${item.name}: przeniesiono istniejącą.`);
        return existing.id;
      }
    }
    // znajdź wolne miejsce w pobliżu środka, jeśli nie podano pozycji
    let pos: Vec3 = position ?? [0, 0, 0];
    if (!position) {
      const taken = p.objects.map((o) => o.position);
      let r = 0;
      let found = false;
      for (let ring = 0; ring < 8 && !found; ring++) {
        const n = ring === 0 ? 1 : ring * 6;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const cand: Vec3 = [Math.cos(ang) * r, 0, Math.sin(ang) * r];
          const free = taken.every((t) => Math.hypot(t[0] - cand[0], t[2] - cand[2]) > item.footprint + 0.9);
          if (free) {
            pos = cand;
            found = true;
            break;
          }
        }
        r += 2.2;
      }
    }
    get().setPalace((pl) => {
      pl.objects.push({ id, type, name: item.name, position: pos, rotationY: rotationY ?? (item.unique ? Math.atan2(pos[0], pos[2]) : 0), scale: [1, 1, 1], anchorId });
    });
    set({ selectedId: id, ...(get().placing ? {} : { leftTab: 'scene' as const }) });
    return id;
  },

  removeObject(id) {
    const obj = get().palace().objects.find((o) => o.id === id);
    const interiorId = obj?.interiorId;
    get().setPalace((pl) => {
      // to, co stało na usuwanym obiekcie, opada na ziemię
      for (const k of pl.objects) {
        if (k.anchorId !== id) continue;
        const drop = k.position[1];
        k.anchorId = undefined;
        k.position[1] = 0;
        for (const deep of descendants(pl.objects, k.id)) deep.position[1] -= drop;
      }
      pl.objects = pl.objects.filter((o) => o.id !== id);
      pl.path = pl.path.filter((x) => x !== id);
    });
    if (interiorId) {
      // budynek znika razem ze swoim wnętrzem i wnętrzami w nim zagnieżdżonymi
      const d = get().data;
      const doomed = new Set([interiorId, ...collectSubtree(interiorId, d.palaces).map((p) => p.id)]);
      const palaces = d.palaces.filter((p) => !doomed.has(p.id));
      const currentId = doomed.has(d.currentId) ? palaces[0].id : d.currentId;
      set({ data: { ...d, palaces, currentId } });
      scheduleSave(get, set);
    }
    if (get().selectedId === id) set({ selectedId: null });
  },

  updateObject(id, patch, opts) {
    get().setPalace(
      (pl) => {
        const o = pl.objects.find((x) => x.id === id);
        if (!o) return;
        const oldPos: Vec3 = [...o.position];
        const oldRot = o.rotationY;
        Object.assign(o, patch);
        const movedPos = patch.position !== undefined;
        const movedRot = patch.rotationY !== undefined && patch.rotationY !== oldRot;
        if (!movedPos && !movedRot) return;
        // obiekty stojące na tym obiekcie jadą razem z nim
        const kids = descendants(pl.objects, id);
        if (kids.length === 0) return;
        const d: Vec3 = [o.position[0] - oldPos[0], o.position[1] - oldPos[1], o.position[2] - oldPos[2]];
        const dRot = o.rotationY - oldRot;
        const cos = Math.cos(dRot);
        const sin = Math.sin(dRot);
        for (const k of kids) {
          if (movedRot) {
            // obrót wokół osi kotwicy zachowuje wzajemne ustawienie
            const rx = k.position[0] - oldPos[0];
            const rz = k.position[2] - oldPos[2];
            k.position[0] = oldPos[0] + rx * cos + rz * sin;
            k.position[2] = oldPos[2] - rx * sin + rz * cos;
            k.rotationY += dRot;
          }
          k.position[0] += d[0];
          k.position[1] += d[1];
          k.position[2] += d[2];
        }
      },
      { undo: opts?.undo },
    );
  },

  /** Zdejmuje obiekt z kotwicy i opuszcza go na ziemię. */
  dropToGround(id) {
    get().setPalace((pl) => {
      const o = pl.objects.find((x) => x.id === id);
      if (!o) return;
      const drop = o.position[1];
      o.anchorId = undefined;
      o.position[1] = 0;
      for (const k of descendants(pl.objects, id)) k.position[1] -= drop;
    });
  },

  duplicateObject(id) {
    const src = get().palace().objects.find((o) => o.id === id);
    if (!src) return;
    const nid = uid();
    get().setPalace((pl) => {
      pl.objects.push({ ...JSON.parse(JSON.stringify(src)), id: nid, note: undefined, interiorId: undefined, anchorId: undefined, position: [src.position[0] + 1.5, 0, src.position[2] + 1.5] });
    });
    set({ selectedId: nid });
  },

  select(id) {
    set({ selectedId: id });
  },
  setHover(id) {
    if (get().hoverId !== id) set({ hoverId: id });
  },
  setTool(tool) {
    set({ tool });
  },
  setViewMode(viewMode) {
    set({ viewMode });
  },
  setLeftTab(leftTab) {
    set({ leftTab });
  },

  setNote(id, title, body) {
    get().setPalace((pl) => {
      const o = pl.objects.find((x) => x.id === id);
      if (!o) return;
      const now = Date.now();
      if (o.note) {
        o.note.title = title;
        o.note.body = body;
        o.note.updatedAt = now;
      } else {
        o.note = { title, body, createdAt: now, updatedAt: now, srs: newSrs() };
        if (!pl.path.includes(id)) pl.path.push(id);
      }
    });
  },
  clearNote(id) {
    get().setPalace((pl) => {
      const o = pl.objects.find((x) => x.id === id);
      if (o) o.note = undefined;
      pl.path = pl.path.filter((x) => x !== id);
    });
  },

  togglePath(id) {
    get().setPalace((pl) => {
      if (pl.path.includes(id)) pl.path = pl.path.filter((x) => x !== id);
      else pl.path.push(id);
    });
  },
  movePath(id, dir) {
    get().setPalace((pl) => {
      const i = pl.path.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= pl.path.length) return;
      [pl.path[i], pl.path[j]] = [pl.path[j], pl.path[i]];
    });
  },

  createPalace(name) {
    const p = makePalace(name ?? `Nowy pałac ${get().data.palaces.length + 1}`);
    const d = get().data;
    set({ data: { ...d, palaces: [...d.palaces, p], currentId: p.id }, selectedId: null, undoStack: [], redoStack: [], review: null });
    scheduleSave(get, set);
  },
  switchPalace(id) {
    const d = get().data;
    if (!d.palaces.some((p) => p.id === id)) return;
    set({ data: { ...d, currentId: id }, selectedId: null, undoStack: [], redoStack: [], review: null, focusRequest: get().focusRequest + 1 });
    scheduleSave(get, set);
  },
  renamePalace(name) {
    get().setPalace((pl) => {
      pl.name = name;
    }, { undo: false });
  },
  deletePalace(id) {
    const d = get().data;
    const doomed = new Set([id, ...collectSubtree(id, d.palaces).map((p) => p.id)]);
    let palaces = d.palaces.filter((p) => !doomed.has(p.id));
    if (palaces.length === 0) palaces = [makePalace()];
    const currentId = doomed.has(d.currentId) ? (palaces.find((p) => !p.parentId) ?? palaces[0]).id : d.currentId;
    set({ data: { ...d, palaces, currentId }, selectedId: null, undoStack: [], redoStack: [], review: null });
    scheduleSave(get, set);
  },
  importPalaces(imported) {
    const d = get().data;
    const firstRoot = imported.find((p) => !p.parentId) ?? imported[0];
    set({ data: { ...d, palaces: [...d.palaces, ...imported], currentId: firstRoot?.id ?? d.currentId }, selectedId: null, undoStack: [], redoStack: [], focusRequest: get().focusRequest + 1 });
    scheduleSave(get, set);
  },
  setSettings(patch) {
    get().setPalace((pl) => {
      pl.settings = { ...pl.settings, ...patch };
    }, { undo: false });
  },

  pushUndo() {
    const p = get().palace();
    const snap: Snapshot = JSON.parse(JSON.stringify({ objects: p.objects, path: p.path }));
    const undoStack = [...get().undoStack, snap].slice(-60);
    set({ undoStack, redoStack: [] });
  },
  undo() {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const p = get().palace();
    const current: Snapshot = JSON.parse(JSON.stringify({ objects: p.objects, path: p.path }));
    const snap = undoStack[undoStack.length - 1];
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...get().redoStack, current] });
    get().setPalace((pl) => {
      pl.objects = snap.objects;
      pl.path = snap.path;
    }, { undo: false });
    const sel = get().selectedId;
    if (sel && !snap.objects.some((o) => o.id === sel)) set({ selectedId: null });
  },
  redo() {
    const { redoStack } = get();
    if (redoStack.length === 0) return;
    const p = get().palace();
    const current: Snapshot = JSON.parse(JSON.stringify({ objects: p.objects, path: p.path }));
    const snap = redoStack[redoStack.length - 1];
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...get().undoStack, current] });
    get().setPalace((pl) => {
      pl.objects = snap.objects;
      pl.path = snap.path;
    }, { undo: false });
  },

  startReview(onlyDue = false) {
    const d = get().data;
    const root = rootOf(d.currentId, d.palaces);
    const stops = flattenStops(root.id, d.palaces, onlyDue);
    if (stops.length === 0) {
      get().showToast(onlyDue ? 'Nic nie czeka na powtórkę. Wróć jutro.' : 'Najpierw dodaj notatkę do jakiegoś obiektu.');
      return;
    }
    set({ review: { stops, index: 0, revealed: false, results: {}, finished: false, rootId: root.id }, selectedId: null, tool: 'select' });
    get().goToStop(stops[0]);
  },
  reveal() {
    const r = get().review;
    if (r) set({ review: { ...r, revealed: true } });
  },
  rate(rating) {
    const r = get().review;
    if (!r) return;
    const stop = r.stops[r.index];
    get().mutatePalace(stop.palaceId, (pl) => {
      const o = pl.objects.find((x) => x.id === stop.objectId);
      if (o?.note) o.note.srs = reviewSrs(o.note.srs, rating);
    }, { undo: false });
    const results = { ...r.results, [stop.objectId]: rating };
    if (r.index >= r.stops.length - 1) set({ review: { ...r, results, finished: true, revealed: true } });
    else {
      set({ review: { ...r, results, index: r.index + 1, revealed: false } });
      get().goToStop(r.stops[r.index + 1]);
    }
  },
  nextStop() {
    const r = get().review;
    if (!r || r.finished) return;
    if (r.index >= r.stops.length - 1) {
      set({ review: { ...r, finished: true, revealed: true } });
      return;
    }
    set({ review: { ...r, index: r.index + 1, revealed: false } });
    get().goToStop(r.stops[r.index + 1]);
  },
  prevStop() {
    const r = get().review;
    if (!r || r.index === 0) return;
    set({ review: { ...r, index: r.index - 1, revealed: false, finished: false } });
    get().goToStop(r.stops[r.index - 1]);
  },

  /** Przechodzi do przystanku, w razie potrzeby przełączając scenę na wnętrze albo z powrotem. */
  goToStop(stop) {
    const d = get().data;
    if (stop.palaceId !== d.currentId) {
      const from = get().palace();
      const goingIn = from.objects.some((o) => o.interiorId === stop.palaceId);
      const target = d.palaces.find((p) => p.id === stop.palaceId);
      set({
        data: { ...d, currentId: stop.palaceId },
        selectedId: null,
        hoverId: null,
        undoStack: [],
        redoStack: [],
        doorPrompt: null,
        sceneEntry: goingIn
          ? { kind: 'enter', objectId: target?.parentObjectId ?? '', seq: ++entrySeq }
          : { kind: 'exit', objectId: from.parentObjectId ?? '', seq: ++entrySeq },
      });
      scheduleSave(get, set);
    }
    get().flyTo(stop.objectId);
  },
  endReview() {
    set({ review: null });
  },
  flyTo(objectId) {
    set({ fly: { objectId, seq: ++flySeq } });
  },
  setVrActive(vrActive) {
    set({ vrActive });
  },
  showToast(msg) {
    set({ toast: msg });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
  },
  camera(kind) {
    set({ cameraCmd: { kind, seq: ++camSeq } });
  },
  setTopView(topView) {
    if (get().topView !== topView) set({ topView });
  },
  setSound(patch) {
    const sound = { ...get().sound, ...patch };
    setPref(SOUND_PREF, sound);
    set({ sound });
  },
}));

export function useCurrentPalace(): Palace {
  return useStore((s) => s.data.palaces.find((p) => p.id === s.data.currentId) ?? s.data.palaces[0]);
}

/** Ile notatek czeka na powtórkę w całym drzewie pałacu (razem z wnętrzami). */
export function dueCount(p: Palace, palaces: Palace[], now = Date.now()): number {
  return dueInTree(rootOf(p.id, palaces).id, palaces, now);
}
