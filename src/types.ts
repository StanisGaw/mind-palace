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
}

/** Obiekt układu pokoju we współrzędnych względnych (patrz `lib/presets.ts`). */
export interface PresetObject {
  type: string;
  name?: string;
  u: number; // -0.5..0.5 względem szerokości pokoju
  v: number; // -0.5..0.5 względem głębokości pokoju
  floor: number;
  dy?: number; // wysokość nad podłogą piętra
  rotationY: number;
  scale?: Vec3;
  span?: { axis: 'x' | 'z'; frac: number }; // ściany: długość jako ułamek wymiaru pokoju
  anchor?: number; // indeks obiektu w układzie, w którym ten obiekt jest zakotwiczony (drzwi w ściance)
}

/** Gotowy układ pokoju: wbudowany albo zapisany przez użytkownika. */
export interface RoomPreset {
  id: string;
  name: string;
  description: string;
  buildingTypes?: string[]; // brak = dla wszystkich typów budynków
  floors: number;
  objects: PresetObject[];
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
