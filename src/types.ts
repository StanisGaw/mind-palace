export type Vec3 = [number, number, number];

export type Category = 'building' | 'lighting' | 'furniture' | 'plant' | 'landscape' | 'object' | 'animal' | 'special' | 'structure';

export interface SrsState {
  interval: number; // dni
  ease: number;
  due: number; // timestamp ms
  reps: number;
  lapses: number;
  lastReview?: number;
}

export interface Note {
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  srs: SrsState;
}

export interface PalaceObject {
  id: string;
  type: string; // id z katalogu
  name: string;
  position: Vec3;
  rotation: Vec3; // kąty Eulera XYZ w radianach (dawniej samo `rotationY`)
  scale: Vec3; // osobno na osiach X/Y/Z
  note?: Note;
  interiorId?: string; // id pałacu-wnętrza (tylko budynki)
  anchorId?: string; // obiekt, na którym stoi ten obiekt (rusza się razem z nim)
  groupId?: string; // grupa: kliknięcie zaznacza wszystkich członków, ruszają się i giną razem
  interiorMode?: 'inplace'; // budynek: wnętrze w tej samej scenie (brak = osobny pałac-wnętrze)
  floors?: number; // budynek z wnętrzem w miejscu: liczba kondygnacji nad ziemią (1–4)
  basement?: boolean; // budynek z wnętrzem w miejscu: kondygnacja pod ziemią (poziom −1), bez okien i elewacji
  colors?: Record<string, string>; // nadpisane kolory warstw materiałów (rola → #rrggbb), patrz `lib/materials.ts`
  finish?: { floor?: string; wall?: string; facade?: string }; // tekstury budynku w miejscu (podłoga, ściana wewnątrz, elewacja); dla ścieżki `floor` to nawierzchnia
  shellVersion?: 2 | 3 | 4 | 5; // 2: piętra podwyższają bryłę (stała wysokość kondygnacji); 3: szersza i wyższa wieża; 4: większe wnętrza domku, pałacu i biblioteki; 5: wnętrza o czterokrotnym polu; brak = stary podział bryły
}

/** Wymiary proceduralnego wnętrza budynku. */
export interface RoomSpec {
  width: number;
  depth: number;
  height: number;
  windows: number; // okna są teraz obiektami biblioteki — pole służy tylko migracji starych pałaców
  floor: string;
  wall: string;
}

export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'storm';
export type Scenery = 'none' | 'meadow' | 'mountains' | 'coast' | 'desert';

export type GroundShape = 'rect' | 'circle' | 'hex';

/** Głośność warstw dźwięków otoczenia, 0..1 (preferencja użytkownika, nie dane pałacu). */
export interface SoundLevels {
  master: number;
  rain: number;
  storm: number;
  snow: number;
  wind: number;
  animals: number;
  crickets: number;
}

/** Kształt i wymiary płyty, po której się chodzi. */
export interface GroundSpec {
  width: number;
  depth: number;
  shape: GroundShape;
  /** Plansza narysowana: kafle siatki (patrz `GROUND_TILE`). Gdy jest, `shape`, `width` i `depth` nie liczą się. */
  tiles?: [number, number][];
}

export interface PalaceSettings {
  grid: boolean;
  showPath: boolean;
  ground: GroundSpec;
  ambience: string;
  weather: Weather;
  scenery: Scenery;
  seed: number;
  groundTexture?: string; // id tekstury płyty (albo podłogi we wnętrzu)
  wallTexture?: string; // wnętrze ładowane: tekstura ścian pokoju
}

export interface Palace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  objects: PalaceObject[];
  path: string[]; // uporządkowane id obiektów
  settings: PalaceSettings;
  parentId?: string; // pałac nadrzędny (gdy to wnętrze)
  parentObjectId?: string; // budynek, w którym jest to wnętrze
  interior?: { buildingType: string; floors: number; lamps?: true }; // `lamps`: lampy są już obiektami (migracja)
  /** Zgłoszone „zepsute kafle" — miejsca z niewidzialną ścianą albo innym błędem, do dochodzenia (patrz `lib/brokenTiles.ts`). */
  brokenTiles?: BrokenTile[];
}

/** Obiekt w pobliżu zgłoszonego kafla — migawka z chwili zgłoszenia, bo obiekty mogą się potem przesunąć. */
export interface BrokenTileNeighbour {
  id: string;
  type: string;
  name: string;
  position: Vec3;
  rotationY: number;
  scale: Vec3;
  /** Odległość w rzucie od punktu zgłoszenia, w metrach. */
  distance: number;
}

/** Zgłoszenie błędu w konkretnym miejscu sceny: dokładny punkt kliknięcia i kafel siatki 1 × 1 m, w którym leży. */
export interface BrokenTile {
  id: string;
  point: Vec3;
  /** Kafel siatki metrowej: [floor(x), floor(z)]. */
  tile: [number, number];
  createdAt: number;
  note?: string;
  nearby: BrokenTileNeighbour[];
}

/** Obiekt zestawu we współrzędnych względem punktu wstawienia, w METRACH (patrz `lib/sets.ts`). */
export interface SetObject {
  type: string;
  name?: string;
  /** Przesunięcie w metrach od punktu wstawienia zestawu (środek jego obrysu w rzucie). */
  dx: number;
  dz: number;
  dy?: number; // wysokość nad podłogą piętra
  rotationY: number;
  scale?: Vec3;
  length?: number; // ścianka: długość w metrach (zestaw ma stałe wymiary, nie ułamki pokoju)
  anchor?: number; // indeks obiektu w zestawie, na którym stoi ten obiekt (wazon na kredensie)
  colors?: Record<string, string>; // nadpisane kolory warstw, jak w `PalaceObject`
  finish?: { floor?: string; wall?: string; facade?: string };
}

/** Gotowy zestaw mebli: wbudowany albo zapisany przez użytkownika. Ten sam w każdym rodzaju budynku. */
export interface FurnitureSet {
  id: string;
  name: string;
  description: string;
  /** Obrys w metrach — pierścień podglądu i przyciąganie tyłem do ściany. */
  width: number;
  depth: number;
  back?: boolean; // zestaw ma tył (krawędź −Z) do przystawienia do ściany
  outdoor?: boolean; // ogród — stawiany tylko na planszy
  objects: SetObject[];
  custom?: boolean;
}

export interface AppData {
  version: 2;
  currentId: string;
  palaces: Palace[];
}

export type Tool = 'select' | 'move';
export type ViewMode = 'editor' | 'fp' | 'vr';
export type CameraKind = 'zoomIn' | 'zoomOut' | 'fit' | 'reset' | 'center' | 'topView';

export type Rating = 'again' | 'hard' | 'good' | 'easy';
