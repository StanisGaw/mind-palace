import { create } from 'zustand';
import type { AppData, CameraKind, Palace, PalaceObject, Rating, RoomPreset, SoundLevels, Tool, Vec3, ViewMode } from './types';
import { ROOMS, catalogItem, hasInterior } from './catalog';
import { uid } from './lib/ids';
import { yawRotation } from './lib/transform';
import { getPref, setPref } from './lib/prefs';
import { chainOf, collectSubtree, loadData, makeInteriorPalace, makePalace, rootOf, saveData } from './lib/storage';
import { DOOR_SLOT, FLOOR_MAX, SHELLS, buildingFloorY, buildingOf, clampToRoom, doorRange, doorSlotFree, floorOf, floorOfIn, isInPlace, mergedWall, roomSpecFor, wallChains, wallOffsetOf, wallPointAt } from './lib/rooms';
import { ROOM_PRESETS, capturePreset, instantiatePreset } from './lib/presets';
import { loadCustomPresets, saveCustomPresets } from './lib/presetStore';
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
  selectedIds: string[]; // zaznaczone obiekty; pierwszy jest „głównym” (inspektor, kotwica gizma)
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
  doorPrompt: { kind: 'enter' | 'exit' | 'door'; objectId?: string; label: string } | null;
  placing: { type: string } | null; // element wybrany z biblioteki, czeka na kliknięcie w scenie
  sound: SoundLevels; // głośność dźwięków otoczenia; trzymana w preferencjach, nie w danych pałacu
  editFloor: number; // piętro edytowane w edytorze (nieutrwalane — zerowane przy zmianie sceny)
  activeBuildingId: string | null; // budynek z wnętrzem w miejscu, któremu edytor chowa dach (nieutrwalane)
  customPresets: RoomPreset[]; // własne układy pokoi, poza danymi pałacu (jak własne tekstury)

  palace(): Palace;
  setPalace(mut: (p: Palace) => void, opts?: { undo?: boolean }): void;
  mutatePalace(id: string, mut: (p: Palace) => void, opts?: { undo?: boolean }): void;
  // wnętrza
  rootPalaces(): Palace[];
  breadcrumb(): Palace[];
  enterInterior(objectId: string): void;
  exitInterior(): void;
  setDoorPrompt(p: State['doorPrompt']): void;
  setEditFloor(n: number): void;
  setActiveBuilding(id: string | null): void;
  setBuildingFloors(id: string, n: number): void;
  setInteriorMode(id: string, mode: 'inplace' | 'nested'): void;
  setFloors(n: number): void;
  // presety pokoi
  applyRoomPreset(id: string): void;
  saveCurrentAsPreset(name: string): void;
  deleteCustomPreset(id: string): void;
  importPresets(list: RoomPreset[]): void;
  // obiekty
  addObject(type: string, position?: Vec3, rotationY?: number, anchorId?: string, scale?: Vec3): string;
  dropToGround(id: string): void;
  /** Scala współliniowe, stykające się ścianki spośród podanych; zwraca id ścianek, które zostały. */
  mergeWalls(ids: string[], opts?: { undo?: boolean }): string[];
  setPlacing(p: { type: string } | null): void;
  removeObject(id: string): void;
  updateObject(id: string, patch: Partial<PalaceObject>, opts?: { undo?: boolean }): void;
  duplicateObject(id: string): void;
  select(id: string | null): void;
  /** Zaznacza sam obiekt, bez reszty jego grupy (edycja członka grupy). */
  selectOnly(id: string): void;
  groupSelected(): void;
  ungroupSelected(): void;
  setSelection(ids: string[]): void;
  toggleSelected(id: string): void;
  updateObjects(list: { id: string; patch: Partial<PalaceObject> }[], opts?: { undo?: boolean }): void;
  removeObjects(ids: string[]): void;
  duplicateSelected(): void;
  arrangeSelected(opts: { columns: number; gapX: number; gapZ: number }): void;
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

/** Zaznaczone obiekty bez tych, które stoją na innym zaznaczonym — te i tak jadą razem ze swoją podstawą. */
export function selectionRoots(objects: PalaceObject[], ids: string[]): PalaceObject[] {
  const chosen = new Set(ids);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out: PalaceObject[] = [];
  for (const id of ids) {
    const o = byId.get(id);
    if (!o) continue;
    let cur = o.anchorId ? byId.get(o.anchorId) : undefined;
    const seen = new Set<string>();
    let underSelected = false;
    while (cur && !seen.has(cur.id)) {
      if (chosen.has(cur.id)) {
        underSelected = true;
        break;
      }
      seen.add(cur.id);
      cur = cur.anchorId ? byId.get(cur.anchorId) : undefined;
    }
    if (!underSelected) out.push(o);
  }
  return out;
}

/** Podane id plus wszyscy członkowie ich grup (kolejność: najpierw podane, potem reszta). */
export function expandGroups(objects: PalaceObject[], ids: string[]): string[] {
  const out = new Set(ids);
  const groups = new Set<string>();
  for (const o of objects) if (out.has(o.id) && o.groupId) groups.add(o.groupId);
  if (groups.size > 0) for (const o of objects) if (o.groupId && groups.has(o.groupId)) out.add(o.id);
  return Array.from(out);
}

/** Jak `selectionRoots`, ale bez drzwi, których ścianka nie jest zaznaczona — drzwi ruszają się tylko po swojej ściance. */
export function movableRoots(objects: PalaceObject[], ids: string[]): PalaceObject[] {
  return selectionRoots(objects, ids).filter((o) => o.type !== 'door');
}

/** Wysokość podłogi, na którą opada obiekt zdjęty z kotwicy: piętro we wnętrzu, 0 na planszy. */
function groundYOf(pl: Palace, y: number): number {
  if (!pl.interior) return 0;
  const h = (ROOMS[pl.interior.buildingType] ?? ROOMS.house).height;
  return floorOf(y, h) * h;
}

/** Nakłada zmianę na obiekt; to, co na nim stoi, przesuwa się i obraca razem z nim. */
function applyObjectPatch(pl: Palace, id: string, patch: Partial<PalaceObject>) {
  const o = pl.objects.find((x) => x.id === id);
  if (!o) return;
  const oldPos: Vec3 = [...o.position];
  const oldYaw = o.rotation[1];
  Object.assign(o, patch);
  const movedPos = patch.position !== undefined;
  // dzieci podążają tylko za obrotem wokół osi pionowej — przechył podstawy ich nie przechyla
  const movedRot = patch.rotation !== undefined && patch.rotation[1] !== oldYaw;
  if (!movedPos && !movedRot) return;
  const kids = descendants(pl.objects, id);
  if (kids.length === 0) return;
  const d: Vec3 = [o.position[0] - oldPos[0], o.position[1] - oldPos[1], o.position[2] - oldPos[2]];
  const dRot = o.rotation[1] - oldYaw;
  const cos = Math.cos(dRot);
  const sin = Math.sin(dRot);
  for (const k of kids) {
    if (movedRot) {
      // obrót wokół osi kotwicy zachowuje wzajemne ustawienie
      const rx = k.position[0] - oldPos[0];
      const rz = k.position[2] - oldPos[2];
      k.position[0] = oldPos[0] + rx * cos + rz * sin;
      k.position[2] = oldPos[2] - rx * sin + rz * cos;
      k.rotation[1] += dRot;
    }
    k.position[0] += d[0];
    k.position[1] += d[1];
    k.position[2] += d[2];
  }
}

/** To, co stało na usuwanym obiekcie, opada na podłogę swojego piętra. */
function dropChildrenOf(pl: Palace, id: string) {
  for (const k of pl.objects) {
    if (k.anchorId !== id) continue;
    // w budynku z wnętrzem w miejscu obiekt opada na podłogę jego piętra i zostaje w budynku
    const b = buildingOf(pl.objects, k);
    const groundY = b && b.id !== id ? buildingFloorY(b, floorOfIn(b, k.position[1])) : groundYOf(pl, k.position[1]);
    const drop = k.position[1] - groundY;
    k.anchorId = b && b.id !== id ? b.id : undefined;
    k.position[1] = groundY;
    for (const deep of descendants(pl.objects, k.id)) deep.position[1] -= drop;
  }
}

function seedPalace(): Palace {
  const p = makePalace('Ogród dobrych myśli');
  const add = (type: string, name: string, position: Vec3, rotationY = 0) => {
    const o: PalaceObject = { id: uid(), type, name, position, rotation: yawRotation(rotationY), scale: [1, 1, 1] };
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

/** Po cofnięciu albo ponowieniu zaznaczenie nie może wskazywać obiektów, których już nie ma. */
function pruneSelection(get: () => State, set: (s: Partial<State>) => void, snap: Snapshot) {
  const left = get().selectedIds.filter((id) => snap.objects.some((o) => o.id === id));
  if (left.length !== get().selectedIds.length) set({ selectedIds: left });
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
  selectedIds: [],
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
  editFloor: 0,
  activeBuildingId: null,
  customPresets: loadCustomPresets(),

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
    if (isInPlace(obj)) {
      // wnętrze jest w tej scenie: wystarczy odsłonić budynek i podjechać kamerą
      get().setActiveBuilding(objectId);
      get().camera('center');
      return;
    }
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
    // wymiary pokoju mogły się zmienić (skala budynku) — dociągamy obiekty do nowego wnętrza
    const interior = palaces.find((pp) => pp.id === interiorId)!;
    const spec = roomSpecFor(interior, palaces);
    palaces = palaces.map((pp) => {
      if (pp.id !== interiorId) return pp;
      const copy: Palace = JSON.parse(JSON.stringify(pp));
      copy.settings.ground = { width: spec.width, depth: spec.depth, shape: 'rect' };
      for (const o of copy.objects) {
        const [x, z] = clampToRoom(spec, o.position[0], o.position[2]);
        o.position[0] = x;
        o.position[2] = z;
      }
      return copy;
    });
    set({
      data: { ...d, palaces, currentId: interiorId },
      selectedIds: [],
      hoverId: null,
      undoStack: [],
      redoStack: [],
      doorPrompt: null,
      editFloor: 0,
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
      selectedIds: [],
      hoverId: null,
      undoStack: [],
      redoStack: [],
      doorPrompt: null,
      editFloor: 0,
      sceneEntry: { kind: 'exit', objectId: cur.parentObjectId ?? '', seq: ++entrySeq },
    });
    scheduleSave(get, set);
  },

  setEditFloor(n) {
    const p = get().palace();
    const active = p.objects.find((o) => o.id === get().activeBuildingId);
    const floors = p.interior?.floors ?? active?.floors ?? 1;
    const clamped = Math.min(floors - 1, Math.max(0, Math.round(n)));
    if (get().editFloor !== clamped) set({ editFloor: clamped });
  },
  setActiveBuilding(id) {
    if (get().activeBuildingId === id) return;
    set({ activeBuildingId: id, editFloor: 0 });
  },
  setBuildingFloors(id, n) {
    const p = get().palace();
    const b = p.objects.find((o) => o.id === id);
    if (!b || !isInPlace(b)) return;
    const floors = Math.min(FLOOR_MAX, Math.max(1, Math.round(n)));
    const cur = b.floors ?? 1;
    if (floors === cur) return;
    if (floors < cur && p.objects.some((o) => buildingOf(p.objects, o)?.id === id && floorOfIn(b, o.position[1]) >= floors)) {
      get().showToast('Na usuwanym piętrze stoją obiekty — najpierw je przenieś albo usuń.');
      return;
    }
    get().setPalace((pl) => {
      const o = pl.objects.find((x) => x.id === id);
      if (o) o.floors = floors;
    });
    if (get().activeBuildingId === id && get().editFloor > floors - 1) set({ editFloor: floors - 1 });
  },
  setInteriorMode(id, mode) {
    const p = get().palace();
    const b = p.objects.find((o) => o.id === id);
    if (!b || !hasInterior(b.type)) return;
    if (mode === 'inplace' && isInPlace(b)) return;
    if (mode === 'nested' && !isInPlace(b)) return;
    if (mode === 'inplace') {
      const inside = b.interiorId ? get().data.palaces.find((x) => x.id === b.interiorId) : undefined;
      if (inside && inside.objects.some((o) => o.type !== 'ceiling_lamp')) {
        get().showToast('Osobne wnętrze ma już wyposażenie — najpierw je opróżnij.');
        return;
      }
      const min = SHELLS[b.type]?.minScale ?? 1;
      const bumped = b.scale.map((v) => Math.max(v, min)) as Vec3;
      get().setPalace((pl) => {
        const o = pl.objects.find((x) => x.id === id);
        if (!o) return;
        o.interiorMode = 'inplace';
        o.floors = o.floors ?? 1;
        o.scale = bumped;
      });
      if (bumped.some((v, i) => v !== b.scale[i])) get().showToast(`Skala budynku podniesiona do ${min}, żeby dało się wejść do środka.`);
      get().setActiveBuilding(id);
      return;
    }
    if (p.objects.some((o) => buildingOf(p.objects, o)?.id === id)) {
      get().showToast('W budynku stoją obiekty — najpierw je wynieś albo usuń.');
      return;
    }
    get().setPalace((pl) => {
      const o = pl.objects.find((x) => x.id === id);
      if (!o) return;
      delete o.interiorMode;
      delete o.floors;
    });
    if (get().activeBuildingId === id) get().setActiveBuilding(null);
  },

  setFloors(n) {
    const p = get().palace();
    if (!p.interior) return;
    const floors = Math.min(FLOOR_MAX, Math.max(1, Math.round(n)));
    if (floors === p.interior.floors) return;
    if (floors < p.interior.floors) {
      const H = (ROOMS[p.interior.buildingType] ?? ROOMS.house).height;
      const doomed = p.objects.some((o) => floorOf(o.position[1], H) >= floors);
      if (doomed) {
        get().showToast('Na usuwanym piętrze stoją obiekty — najpierw je przenieś albo usuń.');
        return;
      }
    }
    get().setPalace((pl) => {
      if (pl.interior) pl.interior.floors = floors;
    }, { undo: false });
    if (get().editFloor > floors - 1) set({ editFloor: floors - 1 });
  },

  applyRoomPreset(id) {
    const p = get().palace();
    if (!p.interior) return;
    const preset = [...ROOM_PRESETS, ...get().customPresets].find((r) => r.id === id);
    if (!preset) return;
    const spec = roomSpecFor(p, get().data.palaces);
    get().setPalace((pl) => {
      const keep = pl.objects.filter((o) => o.note);
      pl.objects = [...keep, ...instantiatePreset(preset, spec)];
      const keptIds = new Set(keep.map((o) => o.id));
      pl.path = pl.path.filter((x) => keptIds.has(x));
      if (pl.interior) pl.interior.floors = Math.min(FLOOR_MAX, Math.max(1, preset.floors));
    });
    set({ editFloor: 0 });
  },

  saveCurrentAsPreset(name) {
    const p = get().palace();
    if (!p.interior) return;
    const spec = roomSpecFor(p, get().data.palaces);
    const preset = capturePreset(name, p, spec);
    const list = [...get().customPresets, preset];
    saveCustomPresets(list);
    set({ customPresets: list });
  },

  deleteCustomPreset(id) {
    const list = get().customPresets.filter((p) => p.id !== id);
    saveCustomPresets(list);
    set({ customPresets: list });
  },

  importPresets(list) {
    const merged = [...get().customPresets, ...list];
    saveCustomPresets(merged);
    set({ customPresets: merged });
  },

  setPlacing(p) {
    const cur = get().placing;
    if (cur?.type === p?.type) return;
    set({ placing: p });
  },

  setDoorPrompt(p) {
    const cur = get().doorPrompt;
    // etykieta drzwi obiektowych zmienia się z otwarciem/zamknięciem przy tym samym id — musi też wejść w porównanie
    const same = (!cur && !p) || (cur && p && cur.kind === p.kind && cur.objectId === p.objectId && cur.label === p.label);
    if (!same) set({ doorPrompt: p });
  },

  addObject(type, position, rotationY, anchorId, scale) {
    const item = catalogItem(type);
    const id = uid();
    const p = get().palace();
    // obiekty unikalne (brama) nie duplikują się — przenosimy istniejący
    if (item.unique) {
      const existing = p.objects.find((o) => o.type === type);
      if (existing) {
        const pos = position ?? existing.position;
        get().updateObject(existing.id, { position: pos, rotation: yawRotation(rotationY ?? (position ? Math.atan2(pos[0], pos[2]) : existing.rotation[1])) });
        set({ selectedIds: [existing.id], ...(get().placing ? {} : { leftTab: 'scene' as const }) });
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
    const shell = SHELLS[type];
    // nowe budynki mają wnętrze w tej samej scenie i skalę, przy której gracz mieści się w drzwiach
    const finalScale: Vec3 = shell ? ((scale ?? [1, 1, 1]).map((v) => Math.max(v, shell.minScale)) as Vec3) : (scale ?? [1, 1, 1]);
    get().setPalace((pl) => {
      pl.objects.push({
        id,
        type,
        name: item.name,
        position: pos,
        rotation: yawRotation(rotationY ?? (item.unique ? Math.atan2(pos[0], pos[2]) : 0)),
        scale: finalScale,
        anchorId,
        ...(shell ? { interiorMode: 'inplace' as const, floors: 1 } : {}),
      });
    });
    set({ selectedIds: [id], ...(get().placing ? {} : { leftTab: 'scene' as const }) });
    return id;
  },

  removeObject(id) {
    get().removeObjects([id]);
  },

  removeObjects(ids) {
    const doomed = new Set(ids);
    const p = get().palace();
    // drzwi nie istnieją bez ścianki — giną razem z nią; wyposażenie budynku w miejscu ginie razem z nim
    for (const o of p.objects) {
      if (o.type === 'door' && o.anchorId && doomed.has(o.anchorId)) doomed.add(o.id);
      const b = buildingOf(p.objects, o);
      if (b && doomed.has(b.id)) doomed.add(o.id);
    }
    const victims = p.objects.filter((o) => doomed.has(o.id));
    if (victims.length === 0) return;
    get().setPalace((pl) => {
      for (const id of doomed) dropChildrenOf(pl, id);
      pl.objects = pl.objects.filter((o) => !doomed.has(o.id));
      pl.path = pl.path.filter((x) => !doomed.has(x));
    });
    const interiorIds = victims.map((o) => o.interiorId).filter((x): x is string => !!x);
    if (interiorIds.length > 0) {
      // budynek znika razem ze swoim wnętrzem i wnętrzami w nim zagnieżdżonymi
      const d = get().data;
      const gone = new Set(interiorIds.flatMap((iid) => [iid, ...collectSubtree(iid, d.palaces).map((x) => x.id)]));
      const palaces = d.palaces.filter((x) => !gone.has(x.id));
      const currentId = gone.has(d.currentId) ? palaces[0].id : d.currentId;
      set({ data: { ...d, palaces, currentId } });
      scheduleSave(get, set);
    }
    const left = get().selectedIds.filter((x) => !doomed.has(x));
    if (left.length !== get().selectedIds.length) set({ selectedIds: left });
  },

  updateObject(id, patch, opts) {
    get().updateObjects([{ id, patch }], opts);
  },

  updateObjects(list, opts) {
    get().setPalace(
      (pl) => {
        for (const { id, patch } of list) applyObjectPatch(pl, id, patch);
      },
      { undo: opts?.undo },
    );
  },

  /** Zdejmuje obiekt z kotwicy i opuszcza go na podłogę piętra, na którym stoi. */
  dropToGround(id) {
    get().setPalace((pl) => {
      const o = pl.objects.find((x) => x.id === id);
      if (!o) return;
      const floorH = pl.interior ? (ROOMS[pl.interior.buildingType] ?? ROOMS.house).height : 0;
      const building = buildingOf(pl.objects, o);
      // w budynku z wnętrzem w miejscu „ziemia” to podłoga jego piętra, a kotwicą zostaje budynek
      const groundY = building ? buildingFloorY(building, floorOfIn(building, o.position[1])) : pl.interior ? floorOf(o.position[1], floorH) * floorH : 0;
      const drop = o.position[1] - groundY;
      o.anchorId = building?.id;
      o.position[1] = groundY;
      for (const k of descendants(pl.objects, id)) k.position[1] -= drop;
    });
  },

  mergeWalls(ids, opts) {
    const p = get().palace();
    const chains = wallChains(p.objects.filter((o) => o.type === 'wall' && ids.includes(o.id))).filter((c) => c.length > 1);
    if (chains.length === 0) return [];
    const kept: string[] = [];
    get().setPalace(
      (pl) => {
        for (const chain of chains) {
          const keep = pl.objects.find((o) => o.id === chain[0].id);
          if (!keep) continue;
          const gone = new Set(chain.slice(1).map((w) => w.id));
          // bez `applyObjectPatch`: drzwi w scalanych ściankach mają zostać tam, gdzie stoją
          Object.assign(keep, mergedWall(chain));
          for (const o of pl.objects) if (o.anchorId && gone.has(o.anchorId)) o.anchorId = keep.id;
          pl.objects = pl.objects.filter((o) => !gone.has(o.id));
          pl.path = pl.path.filter((x) => !gone.has(x));
          kept.push(keep.id);
        }
      },
      { undo: opts?.undo },
    );
    const goneAll = new Set(chains.flatMap((c) => c.slice(1).map((w) => w.id)));
    set({ selectedIds: get().selectedIds.filter((id) => !goneAll.has(id)) });
    return kept;
  },

  duplicateObject(id) {
    const src = get().palace().objects.find((o) => o.id === id);
    if (!src) return;
    if (src.type === 'door') {
      get().duplicateSelected();
      return;
    }
    const nid = uid();
    get().setPalace((pl) => {
      pl.objects.push({ ...JSON.parse(JSON.stringify(src)), id: nid, note: undefined, interiorId: undefined, anchorId: undefined, groupId: undefined, position: [src.position[0] + 1.5, 0, src.position[2] + 1.5] });
    });
    set({ selectedIds: [nid] });
  },

  duplicateSelected() {
    const ids = get().selectedIds;
    const p = get().palace();
    const srcs = p.objects.filter((o) => ids.includes(o.id));
    if (srcs.length === 0) return;
    const copyIdOf = new Map(srcs.map((src) => [src.id, uid()]));
    // kopie tworzą własne grupy, żeby nie wtopić się w oryginalne
    const groupIdOf = new Map<string, string>();
    const copies: PalaceObject[] = [];
    let skippedDoors = 0;
    for (const src of srcs) {
      let groupId: string | undefined;
      if (src.groupId) {
        groupId = groupIdOf.get(src.groupId) ?? uid('g');
        groupIdOf.set(src.groupId, groupId);
      }
      const base: PalaceObject = { ...(JSON.parse(JSON.stringify(src)) as PalaceObject), id: copyIdOf.get(src.id)!, note: undefined, interiorId: undefined, anchorId: undefined, groupId };
      if (src.type !== 'door') {
        copies.push({ ...base, position: [src.position[0] + 1.5, groundYOf(p, src.position[1]), src.position[2] + 1.5] });
        continue;
      }
      // drzwi nie istnieją bez ścianki: kopia idzie do kopii ścianki (ten sam odstęp) albo obok oryginału w tej samej ściance
      const wall = p.objects.find((o) => o.id === src.anchorId && o.type === 'wall');
      if (!wall) {
        skippedDoors++;
        continue;
      }
      const wallCopyId = copyIdOf.get(wall.id);
      if (wallCopyId) {
        copies.push({ ...base, anchorId: wallCopyId, position: [src.position[0] + 1.5, src.position[1], src.position[2] + 1.5] });
        continue;
      }
      const { t } = wallOffsetOf(wall, src.position[0], src.position[2]);
      const slot = [t + DOOR_SLOT, t - DOOR_SLOT].find((c) => Math.abs(c) <= doorRange(wall) && doorSlotFree(wall, p.objects, c));
      if (slot === undefined) {
        skippedDoors++;
        continue;
      }
      const [x, z] = wallPointAt(wall, slot);
      copies.push({ ...base, anchorId: wall.id, position: [x, src.position[1], z] });
    }
    if (skippedDoors > 0) get().showToast('W ściance nie ma miejsca na kolejne drzwi.');
    if (copies.length === 0) return;
    get().setPalace((pl) => {
      pl.objects.push(...copies);
    });
    set({ selectedIds: copies.map((c) => c.id) });
  },

  /** Rozstawia zaznaczone obiekty wierszami od lewego-górnego rogu zaznaczenia. */
  arrangeSelected({ columns, gapX, gapZ }) {
    const p = get().palace();
    const roots = movableRoots(p.objects, get().selectedIds);
    if (roots.length < 2) return;
    const cols = Math.max(1, Math.floor(columns));
    const gx = Math.max(0.5, gapX);
    const gz = Math.max(0.5, gapZ);
    const sorted = [...roots].sort((a, b) => a.position[2] - b.position[2] || a.position[0] - b.position[0]);
    const minX = Math.min(...sorted.map((o) => o.position[0]));
    const minZ = Math.min(...sorted.map((o) => o.position[2]));
    get().updateObjects(
      sorted.map((o, i) => ({ id: o.id, patch: { position: [minX + (i % cols) * gx, o.position[1], minZ + Math.floor(i / cols) * gz] as Vec3 } })),
    );
  },

  select(id) {
    set({ selectedIds: id ? expandGroups(get().palace().objects, [id]) : [] });
  },
  selectOnly(id) {
    set({ selectedIds: [id] });
  },
  setSelection(ids) {
    set({ selectedIds: expandGroups(get().palace().objects, ids) });
  },
  toggleSelected(id) {
    const cur = get().selectedIds;
    const members = expandGroups(get().palace().objects, [id]);
    const allIn = members.every((m) => cur.includes(m));
    set({ selectedIds: allIn ? cur.filter((x) => !members.includes(x)) : Array.from(new Set([...cur, ...members])) });
  },
  groupSelected() {
    const ids = new Set(get().selectedIds);
    if (ids.size < 2) return;
    const gid = uid('g');
    get().setPalace((pl) => {
      for (const o of pl.objects) if (ids.has(o.id)) o.groupId = gid;
    });
  },
  ungroupSelected() {
    const ids = new Set(get().selectedIds);
    get().setPalace((pl) => {
      for (const o of pl.objects) if (ids.has(o.id)) delete o.groupId;
    });
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
    set({ data: { ...d, palaces: [...d.palaces, p], currentId: p.id }, selectedIds: [], undoStack: [], redoStack: [], review: null });
    scheduleSave(get, set);
  },
  switchPalace(id) {
    const d = get().data;
    if (!d.palaces.some((p) => p.id === id)) return;
    set({ data: { ...d, currentId: id }, selectedIds: [], undoStack: [], redoStack: [], review: null, editFloor: 0, focusRequest: get().focusRequest + 1 });
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
    set({ data: { ...d, palaces, currentId }, selectedIds: [], undoStack: [], redoStack: [], review: null });
    scheduleSave(get, set);
  },
  importPalaces(imported) {
    const d = get().data;
    const firstRoot = imported.find((p) => !p.parentId) ?? imported[0];
    set({ data: { ...d, palaces: [...d.palaces, ...imported], currentId: firstRoot?.id ?? d.currentId }, selectedIds: [], undoStack: [], redoStack: [], focusRequest: get().focusRequest + 1 });
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
    pruneSelection(get, set, snap);
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
    pruneSelection(get, set, snap);
  },

  startReview(onlyDue = false) {
    const d = get().data;
    const root = rootOf(d.currentId, d.palaces);
    const stops = flattenStops(root.id, d.palaces, onlyDue);
    if (stops.length === 0) {
      get().showToast(onlyDue ? 'Nic nie czeka na powtórkę. Wróć jutro.' : 'Najpierw dodaj notatkę do jakiegoś obiektu.');
      return;
    }
    set({ review: { stops, index: 0, revealed: false, results: {}, finished: false, rootId: root.id }, selectedIds: [], tool: 'select' });
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
        selectedIds: [],
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
