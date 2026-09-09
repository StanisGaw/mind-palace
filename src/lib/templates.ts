import type { Palace, PalaceObject, Vec3 } from '../types';
import { catalogItem } from '../catalog';
import { uid } from './ids';
import { DEFAULT_FINISH, SHELLS, WALL_SEGMENT, buildingLamps, mergePathObjects } from './rooms';
import { makePalace } from './storage';
import { yawRotation } from './transform';

/** Gotowa zawartość nowego pałacu do wyboru przy jego tworzeniu. */
export interface PalaceTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  build: (name: string) => Palace;
}

/** Punkt na planszy (x, z) — obiekty szablonu stoją na ziemi, więc wysokość jest zawsze zerowa. */
type Spot = [number, number];

/** Obrót, przy którym przód obiektu (lokalna oś +Z) patrzy w stronę wskazanego punktu. */
function yawToward(from: Spot, to: Spot): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1]);
}

/** Deterministyczny generator: wioska ma wyglądać tak samo przy każdym utworzeniu. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function put(out: PalaceObject[], type: string, at: Spot, opts: { name?: string; yaw?: number; scale?: number | Vec3 } = {}): PalaceObject {
  const s = opts.scale ?? 1;
  const o: PalaceObject = {
    id: uid(),
    type,
    name: opts.name ?? catalogItem(type).name,
    position: [at[0], 0, at[1]],
    rotation: yawRotation(opts.yaw ?? 0),
    scale: typeof s === 'number' ? [s, s, s] : s,
  };
  out.push(o);
  return o;
}

/**
 * Budynek z wnętrzem w tej samej scenie, tak jak stawia go biblioteka: najmniejsza skala, przy której gracz
 * przechodzi przez drzwi, i lampy na każdej kondygnacji (bez nich wnętrze jest zupełnie ciemne).
 */
function putBuilding(out: PalaceObject[], type: string, at: Spot, name: string, yaw: number, facade?: string): PalaceObject {
  const shell = SHELLS[type];
  const s = shell.minScale;
  const b: PalaceObject = {
    id: uid(),
    type,
    name,
    position: [at[0], 0, at[1]],
    rotation: yawRotation(yaw),
    scale: [s, s, s],
    interiorMode: 'inplace',
    floors: shell.defaultFloors,
    shellVersion: 5,
    finish: facade ? { ...DEFAULT_FINISH, facade } : { ...DEFAULT_FINISH },
  };
  out.push(b);
  out.push(...buildingLamps(b, Array.from({ length: shell.defaultFloors }, (_, k) => k), uid));
  return b;
}

/** Ścieżka od punktu do punktu: długość i obrót wynikają z odcinka, `width` to wielokrotność bazowych 1,2 m. */
function putPath(out: PalaceObject[], from: Spot, to: Spot, width: number, surface: string) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const o = put(out, 'pathway', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], {
    // oś ścieżki to lokalne +X obrócone o `yaw`, czyli wektor (cos yaw, −sin yaw)
    yaw: Math.atan2(-dz, dx),
    scale: [len / WALL_SEGMENT, 1, width],
  });
  o.finish = { floor: surface };
}

interface Area {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Miejsce zajęte przez obiekt w rzucie: promień z katalogu przemnożony przez skalę (ścieżki nie zajmują nic). */
function occupied(objects: PalaceObject[], x: number, z: number, gap: number): boolean {
  return objects.some((b) => {
    if (b.type === 'pathway' || b.type === 'ceiling_lamp') return false;
    const r = catalogItem(b.type).footprint * Math.max(b.scale[0], b.scale[2]);
    return Math.hypot(b.position[0] - x, b.position[2] - z) < r + gap;
  });
}

/**
 * Rozsypuje rośliny po obszarze, omijając to, co już stoi — także własne wcześniejsze drzewa. Zamiast układu
 * w siatkę losowanie z odrzucaniem, bo las w rzędach od razu widać jako sztuczny; góra przy krawędzi obszaru
 * ma promień kilkudziesięciu metrów, więc część losowań przepada i drzew wychodzi mniej, niż proszono.
 */
function scatter(out: PalaceObject[], rand: () => number, type: string, area: Area, count: number, scaleRange: [number, number], gap: number) {
  const r = catalogItem(type).footprint;
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 24; tries++) {
      const x = Math.round((area.x0 + rand() * (area.x1 - area.x0)) * 10) / 10;
      const z = Math.round((area.z0 + rand() * (area.z1 - area.z0)) * 10) / 10;
      const s = Math.round((scaleRange[0] + rand() * (scaleRange[1] - scaleRange[0])) * 100) / 100;
      if (occupied(out, x, z, gap + r * s)) continue;
      put(out, type, [x, z], { yaw: Math.round(rand() * 62) / 10, scale: s });
      break;
    }
  }
}

/**
 * Wioska w dolinie: droga od bramy na południu prowadzi przez rynek ze studnią do dworu na północy,
 * po bokach chaty, biblioteka i wieża widokowa. Plansza jest największa, jaką da się ustawić suwakiem (80 m),
 * a las, wzgórza i góry stoją poza nią — chodzi się po płycie, a krajobraz domyka widok ze wszystkich stron.
 */
function buildVillage(name: string): Palace {
  const p = makePalace(name);
  p.settings = {
    ...p.settings,
    ground: { width: 80, depth: 80, shape: 'rect' },
    groundTexture: 'grass',
    scenery: 'mountains',
    weather: 'clear',
    ambience: 'garden',
  };
  const o: PalaceObject[] = [];
  const rand = rng(20260909);

  // ---------- zabudowa ----------
  const square: Spot = [0, -6]; // skrzyżowanie drogi głównej z poprzeczną, czyli środek rynku
  putBuilding(o, 'palace', [0, -26], 'Dwór na wzgórzu', 0, 'ashlar');
  putBuilding(o, 'library', [17, -17], 'Biblioteka wioski', 0, 'stonewall');
  putBuilding(o, 'temple', [-18, -17], 'Kapliczka', yawToward([-18, -17], square));
  putBuilding(o, 'tower', [27, -29], 'Wieża widokowa', yawToward([27, -29], square), 'stonewall');
  putBuilding(o, 'house', [-15, 1], 'Chata sołtysa', Math.PI / 2, 'siding');
  putBuilding(o, 'house', [-15, 16], 'Chata piekarza', Math.PI / 2);
  putBuilding(o, 'house', [12, 21], 'Chata rybaka', -Math.PI / 2, 'siding');
  put(o, 'gazebo', [20, 12], { name: 'Altana nad stawem', yaw: yawToward([20, 12], [26, 2]), scale: 1.6 });

  // ---------- drogi ----------
  putPath(o, [0, 34], [0, -21], 2, 'gravel'); // główna: od bramy pod schody dworu
  putPath(o, [-20, -6], [22, -6], 1.7, 'gravel'); // poprzeczna: kapliczka — rynek — biblioteka
  putPath(o, [-10, 1], [-1.5, 1], 1.2, 'gravel'); // dojścia do drzwi chat
  putPath(o, [-10, 16], [-1.5, 16], 1.2, 'gravel');
  putPath(o, [7, 21], [1.5, 21], 1.2, 'gravel');
  putPath(o, [17, -11], [17, -6.5], 1.2, 'gravel'); // od biblioteki na drogę poprzeczną
  putPath(o, [-17, -11], [-13.5, -6.5], 1.2, 'gravel'); // od kapliczki na drogę poprzeczną
  putPath(o, [1.5, 12], [19, 12], 1.2, 'gravel'); // alejka do stawu i altany

  // ---------- rynek ----------
  const well: Spot = [5, -1];
  put(o, 'well', well, { name: 'Studnia na rynku' });
  put(o, 'statue', [-5, -1.5], { name: 'Pomnik założycieli', yaw: yawToward([-5, -1.5], square) });
  put(o, 'signpost', [-2.6, -8], { name: 'Drogowskaz', yaw: 0.4 });
  for (const b of [[1.8, 2], [8.6, 1.4], [5, -4.6]] as Spot[]) put(o, 'bench', b, { yaw: yawToward(b, well) });
  for (const f of [[-8.6, -3], [8.4, -8.4], [-8.4, 8]] as Spot[]) put(o, 'flowers', f);
  for (const b of [[-3.4, -12], [3.4, -3], [-3.4, 8], [3.4, 17], [-3.4, 25]] as Spot[]) put(o, 'bush', b, { scale: 1.2 });

  // ---------- brama i światła wzdłuż drogi ----------
  put(o, 'gate', [0, 34], { name: 'Brama wioski', yaw: 0 });
  put(o, 'torch', [-2.8, 33]);
  put(o, 'torch', [2.8, 33]);
  const lanterns: Spot[] = [[2.2, -16], [-2.2, -9], [2.2, -2], [-2.2, 5], [2.2, 12], [-2.2, 19], [2.2, 26], [-2.2, 31]];
  for (const l of lanterns) put(o, 'lantern', l);
  // aleja cyprysów prowadzi wzrok od rynku do dworu
  for (const z of [-12, -16, -20]) for (const x of [-4.8, 4.8]) put(o, 'cypress', [x, z], { scale: 2.1 });
  put(o, 'obelisk', [-7.5, -20], { scale: 1.4 });
  put(o, 'obelisk', [7.5, -20], { scale: 1.4 });

  // ---------- staw, sad i obozowisko ----------
  put(o, 'pond', [26, 2], { name: 'Staw', scale: [3, 2.5, 3] });
  put(o, 'fireflies', [20, 9], { name: 'Świetliki nad stawem' });
  put(o, 'butterflies', [-6.5, 13]);
  put(o, 'insects', [-27, 14], { name: 'Ul w sadzie' });
  const camp: Spot = [-20, 28];
  put(o, 'campfire', camp, { name: 'Ognisko przy sadzie', scale: 1.2 });
  for (const b of [[-22.6, 29.4], [-17.6, 26.6]] as Spot[]) put(o, 'bench', b, { yaw: yawToward(b, camp) });
  put(o, 'rock', [-17, 30.6], { scale: 1.4 });

  // ---------- krajobraz poza planszą ----------
  put(o, 'mountain', [-30, -62], { name: 'Grań północna', scale: 7 });
  put(o, 'mountain', [4, -68], { name: 'Szczyt główny', scale: 9 });
  put(o, 'mountain', [36, -60], { scale: 6.5 });
  put(o, 'mountain', [-62, -34], { scale: 6 });
  put(o, 'mountain', [64, -40], { scale: 5.5 });
  put(o, 'waterfall', [-16, -46], { name: 'Wodospad', yaw: 0.2, scale: 3 });
  put(o, 'hill', [30, -46], { scale: 4 });
  put(o, 'hill', [-42, 8], { scale: 4.5 });
  for (const [x, z, s] of [[-24, -38, 2], [18, -40, 1.6], [-48, -14, 2.4], [42, 12, 2], [-36, 32, 1.8], [34, 30, 1.5]]) put(o, 'rock', [x, z], { scale: s });

  // ---------- las i sad ----------
  scatter(o, rand, 'tree', { x0: -33, x1: -23, z0: 4, z1: 26 }, 10, [1.8, 2.4], 0.5); // sad za chatami
  scatter(o, rand, 'tree', { x0: -52, x1: -30, z0: -22, z1: 34 }, 16, [1.9, 2.9], 0.5); // las zachodni, wchodzi na planszę
  scatter(o, rand, 'tree', { x0: -36, x1: -24, z0: -38, z1: -24 }, 6, [1.9, 2.8], 0.5); // zagajnik pod kapliczką
  scatter(o, rand, 'tree', { x0: 32, x1: 46, z0: -12, z1: 26 }, 8, [1.8, 2.6], 0.5); // zagajnik wschodni
  scatter(o, rand, 'cypress', { x0: -50, x1: -38, z0: -30, z1: 0 }, 5, [1.8, 2.4], 1);
  scatter(o, rand, 'cypress', { x0: 30, x1: 44, z0: -30, z1: -8 }, 5, [1.8, 2.4], 1);

  // ---------- zwierzęta ----------
  put(o, 'spawn_dog', [-6, 4], { name: 'Pies sołtysa' });
  put(o, 'spawn_cat', [9, 17]);
  put(o, 'spawn_bird', [0, -12]);
  put(o, 'spawn_squirrel', [-30, 22]);
  // wilk chodzi tylko po planszy (zwierzęta trzymają się płyty), więc punkt pojawiania stoi w jej pustym rogu
  put(o, 'spawn_wolf', [-34, -30], { name: 'Wilk przy lesie' });

  // ścieżki stykające się końcami mają wspólną grupę — tak samo jak po narysowaniu ich w edytorze
  p.objects = mergePathObjects(o, () => uid('g')).objects;
  return p;
}

export const PALACE_TEMPLATES: PalaceTemplate[] = [
  {
    id: 'empty',
    name: 'Pusta plansza',
    emoji: '🌾',
    description: 'Sama łąka 40 × 40 m. Wszystko stawiasz od zera — najwięcej miejsca na własny pomysł.',
    build: (name) => makePalace(name),
  },
  {
    id: 'village',
    name: 'Wioska w dolinie',
    emoji: '🏘️',
    description: 'Gotowa osada na planszy 80 × 80 m: brama, droga przez rynek ze studnią, dwór, biblioteka, wieża, trzy chaty, staw i las pod górami.',
    build: buildVillage,
  },
];

export const DEFAULT_TEMPLATE = PALACE_TEMPLATES[0].id;

export function buildFromTemplate(id: string, name: string): Palace {
  return (PALACE_TEMPLATES.find((t) => t.id === id) ?? PALACE_TEMPLATES[0]).build(name);
}
