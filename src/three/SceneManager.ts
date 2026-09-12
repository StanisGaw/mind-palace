import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import { useStore, descendants, movableRoots, selectionRoots } from '../store';
import { yawOfObject } from '../lib/transform';
import type { CameraKind, FurnitureSet, Palace, PalaceObject, RoomSpec, Vec3, ViewMode } from '../types';
import { AMBIENCES, catalogItem, hasInterior } from '../catalog';
import { buildModel, buildParachute, disposeObject, modelBounds, modelHeight, modelSlices, type ModelSlice, shellLeafLocal, DOOR_LEAF_LOCAL, EMITTER_ANCHORS, DOORS, GATE_SPAWN, MOUNT_ANCHORS, ASSET_MOUNTS, type BuildCtx } from './builders';
import { assetLoaded, findClip, loadAsset } from './assets';
import { contact, pushOut, type Obstacle } from '../lib/obstacles';
import { mergeByMaterial } from './merge';
import { IDLE_INPUT, MOUNT_SPECS, advanceTrail, isMount, newRideState, resolveBump, rideSettled, stepRide, trailPoint, type MountId, type MountSpec, type RideEnv, type RideInput, type RideState } from '../lib/ride';
import { ART_VARIANTS } from './art';
import { assignSlots, type LightSlot } from '../lib/lightpool';
import { hashString } from './noise';
import { makeTextPanel, disposeTextPanel } from './text';
import { WeatherSystem } from './weather';
import { PuffEmitter, SwarmEmitter, type Updatable } from './particles';
import { buildTerrain, type Terrain } from './terrain';
import { buildRoom, type Room } from './interior';
import { Physics, FOOT_OFFSET, type StaticShape } from './physics';
import { ROOMS, colliderKind, spawnKind } from '../catalog';
import { GROUND_TILE, clampToGround, clipSegment, groundBounds, groundExtent, groundOutlines, groundPolygon, groundRects, insideGround, isDrawnGround, tileAt } from '../lib/ground';
import { DOOR_SLOT, WALL_SEGMENT, WALL_THICKNESS, buildingFloorHeight, buildingFloorY, buildingOf, buildingOpenings, facadeFloorOk, facadeHoles, facadeSlotFree, facadeSnap, basementHoles, basementQuads, isDrawn, isFacade, doorOffsets, doorRange, doorSlotFree, floorOf, floorOfIn, isInPlace, localXZ, roomSpecFor, stairOpenings, wallLength, wallOffsetOf, wallPointAt, SHELLS, TOWER_R, type Opening } from '../lib/rooms';
import { SET_WALL_GAP, furnitureSet, instantiateSet } from '../lib/sets';
import { boxLocal, boxPoint, insideRoom, placementBlock, roomOfBuilding, roomOfSpec, type RoomShape } from '../lib/layout';
import { clipPolygon, rectPolygon, subtractRect, type Rect } from '../lib/rects';
import { getTexture, setMaxAnisotropy } from './textures';
import { nextScale, qualitySpec, type Quality, type QualitySpec } from '../lib/quality';
import { getPref } from '../lib/prefs';
import { Wildlife, type SpawnInfo, type WorldInfo } from './wildlife';
import { Soundscape } from './soundscape';
import { Archery, type ArrowHit } from './archery';
import { loadCustomTextures } from '../lib/textureStore';
import { uid } from '../lib/ids';
import type { GroundSpec } from '../types';

interface Entry {
  id: string;
  type: string;
  group: THREE.Group; // wrapper (pozycja / rotacja / skala)
  model: THREE.Group;
  height: number;
  footprint: number;
  label: CSS2DObject | null;
  labelEl: HTMLDivElement | null;
  labelKey: string;
  panel: THREE.Mesh | null;
  panelKey: string;
  transformKey: string;
  emitter: Updatable | null;
  /** `typ|wysokośćKondygnacji` (ścianka dodatkowo skala X i otwory na drzwi) — zmiana klucza przebudowuje model. */
  buildKey: string;
  /** Pivot skrzydła drzwi (obiekty typu `door` i budynki z wnętrzem w miejscu) — obraca go `toggleDoor`. */
  doorPivot?: THREE.Group;
  /** Ruchome części wierzchowca po nazwie z `userData.rig` (śmigło, skrzydła, nogi, segmenty) — scena rusza nimi w jeździe. */
  parts: Map<string, THREE.Object3D>;
  /** Ramka modelu w jego układzie — obrys przeszkody dla zwierząt i wierzchowców. */
  bounds: THREE.Box3;
  /** Obrys modelu pasmami wysokości (jednostki modelu) — przeszkoda liczy się tym, co jest na danej wysokości. */
  slices: ModelSlice[];
  /** Model z pliku ze szkieletem: mikser i bieżący klip (postój, stęp, galop, lot). */
  anim?: { mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[]; current: string | null; action: THREE.AnimationAction | null };
  /** Budynek z wnętrzem w tej samej scenie: dach do schowania, stropy pięter i ściany do chowania od strony kamery. */
  inplace: boolean;
  roof: THREE.Object3D | null;
  slabs: THREE.Object3D[];
  walls: THREE.Mesh[];
  /** Światła punktowe modelu (latarnia, lampa sufitowa, ognisko) — świeci tylko kilka najbliższych. */
  lights: THREE.PointLight[];
}

/** Czy obiekt jest widoczny razem ze wszystkimi przodkami (raycaster nie sprawdza `visible`). */
function isShown(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}

interface Tween {
  t: number;
  dur: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  onDone?: () => void;
}

const EYE = 1.6;
/** Odległość (m) między graczem a celem orbity przy przejściu spacer ↔ edytor; obie strony muszą używać tej samej wartości. */
const EDITOR_LOOK_AHEAD = 4;
/** Kierunek, z którego świeci słońce (jednostkowy). Mapa cienia jedzie za graczem wzdłuż tej osi. */
const SUN_DIR = new THREE.Vector3(12, 20, 8).normalize();
const sunRight = new THREE.Vector3();
const sunUp = new THREE.Vector3();
const sunFocusTmp = new THREE.Vector3();
const lightPosTmp = new THREE.Vector3();
const fwdTmp = new THREE.Vector3();
/** Połowa boku mapy cienia w spacerze: dalej cieni i tak nie widać, a każdy metr kosztuje ostrość. */
const WALK_SHADOW_HALF = 26;

/** Przejażdżka: gracz siedzi w siodle wierzchowca (samolot, smok, koń, czerw). Dynamika w `lib/ride.ts`. */
interface Ride {
  id: string;
  mount: MountId;
  state: RideState;
  /** Czerw: ślad głowy (płaska tablica xyz w świecie), którym ciągną się segmenty ciała. */
  trail: number[];
  /** Faza animacji liczona czasem (skrzydła w zawisie, ogon) — `state.phase` rośnie tylko z drogą. */
  anim: number;
}
/** Zeskok z siodła: spadek swobodny, potem spadochron. `pos` to stopy gracza. */
interface Descent {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  chute: boolean;
  opened: number; // s od otwarcia czaszy
}
const CHUTE_FALL = 3.2; // m/s opadania na otwartej czaszy
const CHUTE_DRIFT = 5; // m/s sterowania czaszą
const CHUTE_OPEN_TIME = 0.8; // s — czasza łapie powietrze, prędkość wygasa płynnie, nie skokiem
const FREEFALL_MAX = 28; // m/s prędkość graniczna spadku swobodnego
const FREEFALL_DRIFT = 2; // m/s — spadającym ciałem steruje się ledwo
const BAIL_MIN_HEIGHT = 5; // m nad ziemią; niżej skok nie ma sensu — ląduj
const CHUTE_AUTO = 20; // m nad ziemią czasza otwiera się sama: z 28 m/s hamuje przez kilkanaście metrów
const TOP_VIEW_FOV = 18; // wąski kąt = obraz niemal ortograficzny
/** Po tylu milisekundach ekran ładowania schodzi mimo trwającego pobierania — dalej dociąga się w tle. */
const LOADING_TIMEOUT_MS = 20000;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpNdc = new THREE.Vector2();
const tmpE = new THREE.Euler();
// kolejność YXZ: odchylenie, potem pochylenie, na końcu przechył — tak liczy się orientacja samolotu
const flightEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);
// yawOf ma własny wektor — wołający trzymają w tmpV wektor ruchu, który nie może zostać nadpisany
const tmpYaw = new THREE.Vector3();

/** Klucz trybu stawiania: typ z biblioteki, zestaw mebli albo szablon kopii konkretnych obiektów. */
/** Co wiadomo o sprzęcie: dotyk oznacza telefon albo tablet, rdzenie są jedyną miarą mocy w przeglądarce. */
/** Jedyna aktywna scena. Panel jakości obrazu nie ma innej drogi do renderera — jakość to
 *  ustawienie urządzenia (`lib/prefs`), a nie dana pałacu, więc nie idzie przez store. */
let active: SceneManager | null = null;
export function activeScene(): SceneManager | null {
  return active;
}

function deviceEnv() {
  return {
    touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    cores: navigator.hardwareConcurrency ?? 4,
  };
}

function placingKey(p: { type: string; ids?: string[]; setId?: string } | null | undefined): string {
  return p ? `${p.type}|${p.setId ?? ''}|${(p.ids ?? []).join(',')}` : '';
}

/** Bryła kolizji zamkniętego skrzydła: stała dla drzwi z Konstrukcji, z `SHELLS` dla budynków. */
function leafFor(type: string) {
  return type === 'door' ? DOOR_LEAF_LOCAL : (shellLeafLocal(type) ?? DOOR_LEAF_LOCAL);
}

/** Obrót drzwi w ściance: taki jak ścianki albo odwrócony, gdy drzwi miały zawiasy z drugiej strony. */
function doorYawOn(wall: PalaceObject, door: PalaceObject): number {
  const diff = Math.atan2(Math.sin(door.rotation[1] - wall.rotation[1]), Math.cos(door.rotation[1] - wall.rotation[1]));
  return wall.rotation[1] + (Math.abs(diff) > Math.PI / 2 ? Math.PI : 0);
}

/** Wysokość jednej kondygnacji wnętrza (na zewnątrz nieużywana, ale zawsze zdefiniowana). */
function floorHeightFor(p: Palace | null): number {
  if (!p?.interior) return 3.2;
  return (ROOMS[p.interior.buildingType] ?? ROOMS.house).height;
}

/** Największa skala pozioma — do pierścieni, odległości i kolizji kołowych. */
function hs(e: { group: THREE.Group }): number {
  return Math.max(e.group.scale.x, e.group.scale.z);
}

function yawOf(q: THREE.Quaternion): number {
  tmpYaw.set(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-tmpYaw.x, -tmpYaw.z);
}

export class SceneManager {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig = new THREE.Group();
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  /** Drugi uchwyt z pierścieniami obrotu, doczepiony do tego samego celu co strzałki. */
  readonly rotateGizmo: TransformControls;
  /** Trwa naciśnięcie na jednym z uchwytów — drugi jest na ten czas wyłączony. */
  private gizmoArmed = false;
  private gizmoDragging = false;
  private stereo: StereoEffect | null = null;
  private entries = new Map<string, Entry>();
  private ground!: THREE.Mesh;
  private slab!: THREE.Mesh;
  private grid!: THREE.LineSegments;
  private pathLine: THREE.Line | null = null;
  private pathDots = new THREE.Group();
  private selRing: THREE.Mesh;
  private hoverRing: THREE.Mesh;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private weather = new WeatherSystem(this.scene);
  readonly wildlife = new Wildlife(this.scene);
  private sounds = new Soundscape();
  private wildlifeTick = 0;
  private cachedWorld: WorldInfo | null = null;
  private terrain: Terrain | null = null;
  private terrainKey = '';
  private terrainHoleKey = '';
  private room: Room | null = null;
  private roomKey = '';
  private lastEditFloor = 0;
  /** Id otwartych drzwi obiektowych — stan chwilowy, kasowany przy zmianie sceny. */
  private openDoors = new Set<string>();
  private doorAnims: { id: string; from: number; to: number; t: number; dur: number }[] = [];
  private bounds = { hx: 11.6, hz: 11.6 };
  private walkArea: GroundSpec | null = null;
  private lastEntrySeq = 0;
  private lastPalaceId = '';
  private doorCheck = 0;
  private lastGroundKey = '';
  private groundTint = '#cfd6c4';
  private lastTextureKey = '';
  private physics: Physics | null = null;
  private physicsLoading = false;
  private physicsDirty = true;
  private jumpBuffer = 0;
  private physicsDebug: THREE.LineSegments | null = null;
  private readonly debugPhysics = typeof location !== 'undefined' && location.search.includes('physdebug=1');
  private debugTick = 0;
  /** Dodatek wysokości dla rigu: 0 gdy kamera ma własny wzrost, EYE w XR bez podłogi. */
  private headOffset = 0;
  private lastClick: { id: string; t: number } | null = null;
  private pickedExitDoor = false;
  /** Punkt ostatniego trafienia `pickRay` — do sprawdzenia, czy dotknięto budynek przy drzwiach. */
  private pickPoint = new THREE.Vector3();
  // podgląd stawiania
  private ghost: THREE.Group | null = null;
  private ghostRing: THREE.Mesh | null = null;
  private lastActiveBuilding: string | null = null;
  private ghostType = '';
  private ghostKey = '';
  /** Kopiowane obiekty (tryb `template` albo drzwi z `ids`) — kliknięcie tworzy ich kopie. */
  private ghostIds: string[] | null = null;
  /** Stawiany zestaw mebli (tryb `set`) — kliknięcie tworzy jego obiekty. */
  private ghostSet: FurnitureSet | null = null;
  /** Zestaw z tyłem sam ustawia się do ściany, dopóki użytkownik nie obróci podglądu ręcznie. */
  private ghostAutoRot = true;
  /** Rysowanie planszy: podgląd malowanych kafli i kafle dotknięte w bieżącym przeciągnięciu. */
  private brushPreview: THREE.LineSegments | null = null;
  private brushTiles: Map<string, [number, number]> | null = null;
  private brushErase = false;
  private brushLast: [number, number] | null = null;
  /** Miejsce, z którego zaczęło się przeciąganie uchwytem — bez ruchu nie ma czego cofać. */
  private dragFrom: THREE.Vector3 | null = null;
  /** Powód, dla którego podglądu nie wolno postawić (świeca na blacie, obraz na oknie). */
  private placeBlockReason = '';
  private ghostFootprint = 1;
  ghostRot = 0;
  private ghostPos = new THREE.Vector3();
  private ghostAnchor: string | undefined;
  /** Drzwi: miejsce pod kursorem nie leży w ściance albo jest zajęte — kliknięcie odmawia. */
  private ghostBlocked = false;
  /** Drzwi: zawiasy z drugiej strony (klawisz R w trybie stawiania). */
  private doorFlip = false;
  /** Rysowanie ścianki: początek odcinka (po pierwszym kliknięciu) i długość bieżącego podglądu. */
  private wallStart: THREE.Vector3 | null = null;
  private wallLen = 0;
  private wallStartedOnDown = false;
  private wallLabel: CSS2DObject | null = null;
  /** Ostatnio postawiona ścianka w łańcuchu — współliniowy następny odcinek ją wydłuża zamiast tworzyć nowy obiekt. */
  private lastWallId: string | null = null;
  /** Grupa bieżącego ciągu ścieżki — kolejne odcinki trafiają do niej. */
  private drawGroupId: string | null = null;
  private placeDown: { x: number; y: number } | null = null;
  private baseLight = { hemi: 1.1, ambient: 0.35, sun: 2.4 };
  private ambienceFog = { color: '#eceeea', near: 40, far: 120 };
  private envKey = '';
  private tween: Tween | null = null;
  private topView = false;
  /** Rzut z góry chwilowo uwolniony środkowym przyciskiem — po puszczeniu kamera wraca nad planszę. */
  private freeLook = false;
  private savedCam: { pos: THREE.Vector3; target: THREE.Vector3; fov: number } | null = null;
  private clock = new THREE.Clock();
  private unsub: () => void;
  private mode: ViewMode = 'editor';
  private lastPalace: Palace | null = null;
  private lastFlySeq = 0;
  private lastCamSeq = 0;
  private lastFocus = 0;
  private lastReviewKey = '';
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ro: ResizeObserver;
  private quality: Quality;
  private qspec: QualitySpec;
  /** Mnożnik rozdzielczości dobierany automatycznie do czasu klatki; 1 = pełny `qspec.pixelRatio`. */
  private renderScale = 1;
  private frameMs = 16;
  private scaleHold = 0;
  /**
   * Stała pula świateł punktowych dodanych do sceny: zawsze tyle samo i zawsze widocznych, bo liczba
   * widocznych świateł wchodzi do programu shadera — jej zmiana rekompiluje wszystkie materiały sceny.
   * Zmienia się tylko to, które źródło obsadza które miejsce, i natężenie (0 = miejsce ciemne).
   */
  private lightPool: THREE.PointLight[] = [];
  private lightSlots: LightSlot[] = [];
  /** Światła w modelach obiektów — same nigdy nie świecą (`visible = false`), podają tylko barwę, zasięg i miejsce. */
  private lightSources = new Map<string, THREE.PointLight>();
  private lightTick = 0;
  /** Ognisko mapy cienia i jej połowa boku — zmieniamy je dopiero, gdy gracz odejdzie o teksel. */
  private sunFocus = new THREE.Vector3(NaN, 0, NaN);
  private sunHalf = 0;
  private disposed = false;

  // interakcja edytora
  private drag: { id: string; offset: THREE.Vector3; startX: number; startY: number; moved: boolean; ids?: string[]; starts?: Map<string, Vec3> } | null = null;
  private downInfo: { x: number; y: number; hit: string | null; shift: boolean } | null = null;
  /** Ramka zaznaczenia rysowana narzędziem „Zaznacz” na pustym miejscu. */
  private marquee: { x0: number; y0: number; shift: boolean; el: HTMLDivElement | null } | null = null;
  /** Wspólny uchwyt dla kilku zaznaczonych obiektów — stoi w ich środku ciężkości. */
  private pivot = new THREE.Group();
  private multiStart: { pos: THREE.Vector3; items: { id: string; pos: Vec3; rotation: Vec3 }[] } | null = null;
  /** Pula pierścieni zaznaczenia; pierwszy to `selRing`, reszta dzieli z nim geometrię i materiał. */
  private selRings: THREE.Mesh[] = [];

  // pierwsza osoba
  private keys = new Set<string>();
  joystick = { x: 0, y: 0 };
  /** Lewa gałka pada — ten sam układ znaków co joystick dotykowy (w górę = do przodu). */
  private pad = { x: 0, y: 0 };
  private padHeld = new Set<number>();
  private padSprint = false;
  /** Spusty pada w locie: dodatni dodaje gazu, ujemny ujmuje. Analogowe, więc gaz jest płynny. */
  private padThrottle = 0;
  /** L1/R1 w locie: ster kierunku. Prawa gałka zostaje przy rozglądaniu się po kokpicie. */
  private padYaw = 0;
  /** Histereza obrotu skokowego z pada — osobna od kontrolerów, żeby jedno wejście nie rozbrajało drugiego. */
  private padTurnArmed = false;
  private padSeen = false;
  /** Dotyk: po postawieniu zostań w trybie stawiania (odpowiednik Shift). */
  stickyPlacing = false;
  private yaw = 0;
  private pitch = 0;
  /**
   * Palce rozglądające się po scenie — mapa, a nie jedno pole, bo na telefonie drugi kciuk często dochodzi
   * w połowie obrotu (albo trzyma gałkę), a podniesienie jednego palca nie może przerywać ruchu drugiego.
   */
  private touchLook = new Map<number, { x: number; y: number; moved: boolean }>();
  private fpVel = new THREE.Vector3();
  /** Przejażdżka: gracz siedzi w siodle, a `updateRide` prowadzi model i kamerę zamiast `updateFp`. */
  private ride: Ride | null = null;
  /** Łuk w dłoni (prototyp strzelnicy) — `null`, gdy gracz nie trzyma łuku. */
  private archery: Archery | null = null;
  private lastDraw = -1;
  /** Pliki modeli, których wczytanie już ruszyło. */
  private assetLoads = new Set<string>();
  /** Obrysy obiektów dla zwierząt i jazdy; liczone na nowo po każdej zmianie pałacu. */
  private obstacleCache: Obstacle[] | null = null;
  /** Galop z przycisku na telefonie (odpowiednik trzymanego Shift). */
  touchSprint = false;
  private rideHit: string | null = null;
  /** Kiedy ostatnio pokazano komunikat o otarciu — ślizg wzdłuż rzędu wieżowców nie ma zasypywać ekranu. */
  private rideHitAt = 0;
  /** Trwające wczytywania (fizyka, modele z plików) — dopóki coś jest w środku, widać ekran ładowania. */
  private pendingLoads = new Set<string>();
  private loadingSince = 0;
  /** Wejścia jazdy zbierane między klatkami (skok i ogień to zdarzenia, reszta liczona z klawiszy co klatkę). */
  private rideInput: RideInput = { ...IDLE_INPUT };
  private rideEnv: RideEnv = { groundAt: (x, z) => this.groundHeightAt(x, z), radius: 24, scale: 1 };
  private descent: Descent | null = null;
  /** Czasza spadochronu, budowana przy pierwszym otwarciu; między skokami tylko ukryta. */
  private chute: THREE.Group | null = null;
  private xrMove = new THREE.Vector2();
  private snapTurnArmed = false;
  private touchHold = false;
  /** Rozglądanie w trybie stereo, gdy nie ma czujników ruchu (pulpit, brak zgody na telefonie). */
  private vrLook: { id: number; x: number; y: number; moved: boolean } | null = null;
  private touchStart = 0;

  // VR
  private xrSession: XRSession | null = null;
  private xrFloor = true;
  private deviceOrient: { alpha: number; beta: number; gamma: number; orient: number; active: boolean } = { alpha: 0, beta: 0, gamma: 0, orient: 0, active: false };
  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha == null) return;
    this.deviceOrient.alpha = THREE.MathUtils.degToRad(e.alpha);
    this.deviceOrient.beta = THREE.MathUtils.degToRad(e.beta ?? 0);
    this.deviceOrient.gamma = THREE.MathUtils.degToRad(e.gamma ?? 0);
    this.deviceOrient.orient = THREE.MathUtils.degToRad(((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation) ?? 0) as number);
    this.deviceOrient.active = true;
  };

  constructor(container: HTMLElement) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.xr.enabled = true;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    // wzory na podłodze i stropie oglądane pod ostrym kątem mienią się bez filtrowania anizotropowego
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
    this.quality = getPref<Quality>('quality', 'auto');
    this.qspec = qualitySpec(this.quality, deviceEnv());
    this.applyQuality();

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'labels-layer';
    container.appendChild(this.labelRenderer.domElement);

    // bliska płaszczyzna 0,25 zamiast 0,1: przy 400 m dalekiej to 2,5 raza lepsza precyzja bufora głębi.
    // Na telefonie bufor bywa 16-bitowy i przy 0,1 sąsiednie płaszczyzny (podłoga i cokół, mur i okładzina)
    // migotały pasami. Kapsuła gracza ma 0,32 promienia, a orbita w edytorze 3 m minimum, więc nic się nie obcina
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.25, 400);
    // YXZ: w kokpicie rozglądamy się odchyleniem i pochyleniem naraz; poza lotem odchylenie jest zerowe
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, EYE, 0);
    this.rig.add(this.camera);
    this.scene.add(this.rig);
    this.rig.position.set(0, 0, 0);
    // w edytorze kamera jest "wolna": trzymamy ją w rigu w (0,0,0) o zerowej rotacji
    this.rig.rotation.set(0, 0, 0);
    this.camera.position.set(15, 13, 15);
    this.camera.lookAt(0, 0, 0);

    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = 1.45;
    this.orbit.minDistance = 3;
    this.orbit.maxDistance = 70;
    this.orbit.screenSpacePanning = false;
    this.orbit.target.set(0, 0.5, 0);
    // środkowy przycisk obraca widok (kółko nadal przybliża); lewy jest zarezerwowany dla narzędzi
    this.orbit.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;

    // uchwyt transformacji — tylko w edytorze przy narzędziu Przesuń; strzałki i pierścienie to dwie
    // instancje TransformControls na tym samym celu, bo biblioteka umie pokazać naraz jeden tryb
    this.gizmo = new TransformControls(this.camera, renderer.domElement);
    this.gizmo.size = 0.85;
    this.rotateGizmo = new TransformControls(this.camera, renderer.domElement);
    this.rotateGizmo.mode = 'rotate';
    this.rotateGizmo.size = 1.15; // pierścienie poza końcówkami strzałek
    // kwadraty płaszczyzn XY/YZ i ośmiościan w środku przechwytywały kliknięcia w strzałki — zostają
    // strzałki i kwadrat XZ (przeciąganie po ziemi); usuwamy z drzewa, bo `visible` wraca co klatkę
    const planeHandles: THREE.Object3D[] = [];
    this.gizmo.getHelper().traverse((c) => {
      if (c.name === 'XY' || c.name === 'YZ' || c.name === 'XYZ') planeHandles.push(c);
    });
    for (const h of planeHandles) h.removeFromParent();
    for (const g of [this.gizmo, this.rotateGizmo]) {
      g.enabled = false;
      g.rotationSnap = Math.PI / 24;
      this.scene.add(g.getHelper());
      g.addEventListener('dragging-changed', (ev) => {
        const dragging = !!(ev as unknown as { value: boolean }).value;
        this.gizmoDragging = dragging;
        this.orbit.enabled = !dragging && this.mode === 'editor';
        if (dragging) useStore.getState().pushUndo();
        // po przeciągnięciu kilku obiektów pivot wraca do nowego środka ciężkości
        else if (g.object === this.pivot) this.syncGizmo();
      });
      g.addEventListener('objectChange', () => this.onGizmoChange());
      g.addEventListener('mouseDown', () => {
        const obj = this.gizmo.object as THREE.Group | undefined;
        this.dragFrom = obj ? obj.position.clone() : null;
        this.onGizmoMouseDown();
      });
      g.addEventListener('mouseUp', () => {
        this.multiStart = null;
        this.snapAnchorUnder();
        this.dragFrom = null;
      });
    }

    // światła
    this.hemi = new THREE.HemisphereLight('#ffffff', '#b9c2ad', 1.1);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight('#ffffff', 0.35);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight('#fff6e6', 2.4);
    this.sun.position.set(12, 20, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.qspec.shadowMap || 1024, this.qspec.shadowMap || 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.buildLightPool();

    // pierścienie zaznaczenia
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40), new THREE.MeshBasicMaterial({ color: '#2f5a3c', transparent: true, opacity: 0.9, depthWrite: false }));
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.position.y = 0.02;
    this.selRing.visible = false;
    this.scene.add(this.selRing);
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.97, 40), new THREE.MeshBasicMaterial({ color: '#7f8c7a', transparent: true, opacity: 0.55, depthWrite: false }));
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.position.y = 0.015;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
    this.selRings = [this.selRing];
    this.scene.add(this.pivot);
    this.scene.add(this.pathDots);

    this.buildGround({ width: 24, depth: 24, shape: 'rect' });

    // zdarzenia
    const el = renderer.domElement;
    container.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    el.addEventListener('mousemove', this.onMouseMoveLocked);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('blur', this.onWindowBlur);
    container.addEventListener('contextmenu', this.onContextMenu);
    container.addEventListener('wheel', this.onWheel, { capture: true, passive: false });

    active = this;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    // kontrolery XR
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      c.addEventListener('select', () => this.onVrSelect(c));
      c.addEventListener('squeezestart', () => this.jump());
      this.rig.add(c);
    }

    // stan
    const st = useStore.getState();
    this.sounds.setLevels(st.sound);
    this.applyPalace(st.palace(), true);
    this.applySelection(st.selectedIds, st.hoverId);
    this.unsub = useStore.subscribe((s, prev) => this.onState(s, prev));

    renderer.setAnimationLoop((_, frame) => this.frame(frame));
  }

  // ---------- teren ----------
  private buildGround(spec: GroundSpec, holes: Rect[] = [], outlines: [number, number][][] = []) {
    if (this.ground) {
      this.scene.remove(this.ground, this.slab, this.grid);
      this.ground.geometry.dispose();
      this.slab.geometry.dispose();
      this.grid.geometry.dispose();
      // materiały płyty giną razem z nią; nawierzchnia to klon tekstury, więc też trzeba ją zwolnić
      const top = this.ground.material as THREE.MeshStandardMaterial;
      top.map?.dispose();
      top.dispose();
      (this.slab.material as THREE.Material).dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    const size = groundExtent(spec);
    const drawn = isDrawnGround(spec);
    const rects = groundRects(spec);
    const poly = groundPolygon(spec);
    const amb = AMBIENCES.find((a) => a.id === (this.lastPalace?.settings.ambience ?? 'garden')) ?? AMBIENCES[0];

    // UV takie same jak w `ShapeGeometry` (współrzędne świata), żeby `applyGroundTexture` działało tak samo
    // na planszy z kafli blat składamy z prostokątów, więc otwór wycinamy prostokątami; na zwykłej idzie
    // przez triangulację, a ta gubi się przy dziurach stykających się bokami — stąd jeden obrys na budynek
    const topGeo = drawn
      ? rectsGeometry(holes.reduce((acc, h) => subtractRect(acc, h), rects))
      : new THREE.ShapeGeometry(shapeWithHoles(poly, outlines, true));
    topGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ color: amb.ground, roughness: 1 }));
    this.ground.receiveShadow = true;
    this.ground.userData.ground = true;
    this.scene.add(this.ground);

    // bok płyty: dla narysowanej planszy pionowe ścianki tylko wzdłuż krawędzi bez sąsiada
    const slabGeo = drawn
      ? skirtGeometry([...groundOutlines(spec), ...outlines.map(closed)], 0.6)
      : rotatedExtrude(poly, outlines, 0.6);
    this.slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: '#b7bba9', roughness: 1, side: THREE.DoubleSide }));
    this.slab.position.y = -0.01;
    this.slab.receiveShadow = true;
    this.scene.add(this.slab);

    // siatka rysowana liniami przyciętymi do obrysu planszy (kafle: do każdego prostokąta osobno)
    const pts: number[] = [];
    const b = groundBounds(spec);
    const from = Math.floor(Math.min(b.x0, b.z0)) - 1;
    const to = Math.ceil(Math.max(b.x1, b.z1)) + 1;
    for (let i = from; i <= to; i++) {
      const segs = drawn
        ? rects.flatMap((r) => [clipSegment([i, from], [i, to], rectPolygon(r)), clipSegment([from, i], [to, i], rectPolygon(r))])
        : [clipSegment([i, from], [i, to], poly), clipSegment([from, i], [to, i], poly)];
      for (const seg of segs) {
        if (!seg) continue;
        pts.push(seg[0][0], 0, seg[0][1], seg[1][0], 0, seg[1][1]);
      }
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: '#9aa391', transparent: true, opacity: 0.45 }));
    this.grid.position.y = 0.012;
    this.scene.add(this.grid);

  }

  private applyAmbience(id: string) {
    const amb = AMBIENCES.find((a) => a.id === id) ?? AMBIENCES[0];
    this.scene.background = new THREE.Color(amb.sky);
    this.groundTint = amb.ground;
    const night = id === 'night';
    this.baseLight = { hemi: night ? 0.35 : 1.1, ambient: night ? 0.15 : 0.35, sun: night ? 0.5 : 2.4 };
    // dalsza mgła, żeby pierścień krajobrazu był widoczny i miękko znikał na horyzoncie
    const size = this.lastPalace ? groundExtent(this.lastPalace.settings.ground) : 24;
    this.ambienceFog = { color: amb.fog, near: size * 1.6, far: size * 6 + 60 };
    this.sun.color.set(night ? '#9fb4ff' : '#fff6e6');
    this.hemi.color.set(night ? '#6d7aa8' : '#ffffff');
    (this.grid.material as THREE.LineBasicMaterial).opacity = night ? 0.2 : 0.45;
    this.applyLighting();
  }

  private rebuildTerrain(p: Palace, holes: [number, number][][]) {
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
      this.terrain = null;
    }
    this.terrain = buildTerrain(p.settings.ground, p.settings.scenery, p.settings.seed, holes);
    if (this.terrain) this.scene.add(this.terrain.group);
  }

  /** Nakłada teksturę na płytę albo podłogę wnętrza; brak tekstury = sam kolor klimatu. */
  private applyGroundTexture(p: Palace) {
    const id = p.settings.groundTexture;
    const custom = id?.startsWith('c_') ? loadCustomTextures().find((t) => t.id === id) : undefined;
    const tex = id ? getTexture(id, custom?.dataUrl) : null;
    const target = (p.interior ? this.room?.floor : this.ground) as THREE.Mesh | undefined;
    if (!target) return;
    const mat = target.material as THREE.MeshStandardMaterial;
    if (tex) {
      const size = groundExtent(p.settings.ground);
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(2, Math.round(size / 3)), Math.max(2, Math.round(size / 3)));
      mat.map?.dispose();
      mat.map = t;
      // kolor klimatu działa jak delikatne zabarwienie tekstury
      mat.color.set('#ffffff').lerp(new THREE.Color(this.groundTint), 0.35);
    } else {
      mat.map?.dispose();
      mat.map = null;
      mat.color.set(this.groundTint);
    }
    mat.needsUpdate = true;
  }

  /** Łączy bazowe światło klimatu z modyfikatorami pogody (przyciemnienie, mgła, błysk). */
  private applyLighting() {
    const f = this.weather.lightFactor;
    const flash = this.weather.flash;
    this.hemi.intensity = this.baseLight.hemi * f + flash * 1.6;
    this.ambient.intensity = this.baseLight.ambient * f + flash * 0.5;
    this.sun.intensity = this.baseLight.sun * f + flash * 1.2;
    const base = this.weather.fog ?? this.ambienceFog;
    // z powietrza widać dużo dalej — mgła dobrana do spaceru zamieniłaby lot w mleczną pustkę
    const k = this.riding || this.descent ? 3 : 1;
    const fog = { color: base.color, near: base.near * k, far: base.far * k };
    if (!this.scene.fog || !(this.scene.fog instanceof THREE.Fog)) this.scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    else {
      this.scene.fog.color.set(fog.color);
      this.scene.fog.near = fog.near;
      this.scene.fog.far = fog.far;
    }
  }

  // ---------- synchronizacja stanu ----------
  private onState(s: ReturnType<typeof useStore.getState>, prev: ReturnType<typeof useStore.getState>) {
    const p = s.palace();
    if (p !== this.lastPalace) this.applyPalace(p, false);
    if (s.selectedIds !== prev.selectedIds || s.hoverId !== prev.hoverId) this.applySelection(s.selectedIds, s.hoverId);
    if (s.tool !== prev.tool || s.review !== prev.review) this.syncGizmo();
    if (placingKey(s.placing) !== placingKey(prev.placing)) this.setGhost(s.placing);
    if (!s.groundBrush && prev.groundBrush) {
      // Esc w trakcie pociągnięcia: bez tego podniesienie przycisku i tak zapisałoby kafle
      this.brushTiles = null;
      this.brushLast = null;
      this.orbit.enabled = this.mode === 'editor';
      this.clearBrushPreview();
    }
    if (s.viewMode !== prev.viewMode) this.setMode(s.viewMode);
    if (s.sound !== prev.sound) this.sounds.setLevels(s.sound);
    if (s.fly && s.fly.seq !== this.lastFlySeq) {
      this.lastFlySeq = s.fly.seq;
      this.flyTo(s.fly.objectId);
    }
    if (s.cameraCmd && s.cameraCmd.seq !== this.lastCamSeq) {
      this.lastCamSeq = s.cameraCmd.seq;
      this.cameraCommand(s.cameraCmd.kind);
    }
    if (s.focusRequest !== this.lastFocus) {
      this.lastFocus = s.focusRequest;
      this.cameraCommand('fit');
    }
    if (s.sceneEntry && s.sceneEntry.seq !== this.lastEntrySeq) {
      this.lastEntrySeq = s.sceneEntry.seq;
      this.applySceneEntry(s.sceneEntry.kind, s.sceneEntry.objectId);
    }
    if (s.editFloor !== this.lastEditFloor || s.activeBuildingId !== this.lastActiveBuilding) {
      this.lastEditFloor = s.editFloor;
      this.lastActiveBuilding = s.activeBuildingId;
      this.applyFloorVisibility();
      this.updateGroundPlane();
    }
    const rk = s.review ? `${s.review.index}|${s.review.revealed}|${s.review.finished}` : '';
    if (rk !== this.lastReviewKey) {
      this.lastReviewKey = rk;
      this.refreshPanels(p);
      this.refreshLabels(p);
    }
  }

  private applyPalace(p: Palace, first: boolean) {
    this.lastPalace = p;
    const sceneChanged = p.id !== this.lastPalaceId;
    this.lastPalaceId = p.id;
    this.applyEnvironment(p, sceneChanged);
    if (sceneChanged) {
      // strzały siedzą we wpisach tej sceny — z nową planszą łuk wraca na stojak
      this.dropBow();
      this.physicsDirty = true;
      this.openDoors.clear();
      this.doorAnims = [];
    }
    this.syncObjects(p);
    this.placeRings(useStore.getState().selectedIds, useStore.getState().hoverId);
    this.applyFloorVisibility();
    if (this.physics && this.physicsDirty && this.mode !== 'editor') this.rebuildPhysics();
    this.syncPath(p);
    this.refreshLabels(p);
    this.refreshPanels(p);
    this.syncWildlife();
    if (sceneChanged || first) this.warmShaders();
    if (first) this.cameraCommand('fit', true);
  }

  /**
   * Kompiluje programy shaderów całej sceny z góry. Bez tego sterownik kompiluje każdą bryłę przy pierwszym
   * narysowaniu — w mieście to ~1,8 s rozsypane na kilkanaście pierwszych klatek, już **po** zniknięciu ekranu
   * ładowania. `applyPalace` idzie przed pierwszą klatką nowej sceny, więc tutaj czeka się pod ekranem.
   */
  private warmShaders() {
    this.renderer.compile(this.scene, this.camera);
  }

  /** Czy wpis (obiekt albo marker zwierzęcia) powinien być teraz widoczny. Jedno miejsce dla `syncWildlife` i pięter. */
  private entryVisible(e: Entry): boolean {
    if (spawnKind(e.type) && this.mode !== 'editor') return false; // żywe zwierzę zastępuje marker
    if (this.mode === 'editor' && this.lastPalace?.interior) {
      const H = floorHeightFor(this.lastPalace);
      if (floorOf(e.group.position.y, H) > useStore.getState().editFloor) return false;
    }
    if (this.mode === 'editor' && this.lastPalace && !this.lastPalace.interior) {
      // w aktywnym budynku widać tylko piętra do edytowanego włącznie
      const b = this.activeBuilding();
      const o = b ? this.lastPalace.objects.find((x) => x.id === e.id) : undefined;
      if (b && o && buildingOf(this.lastPalace.objects, o)?.id === b.id && floorOfIn(b, o.position[1]) > useStore.getState().editFloor) return false;
    }
    return true;
  }

  /** Budynek z wnętrzem w miejscu, któremu edytor chowa dach (tylko na planszy, w edytorze). */
  private activeBuilding(): PalaceObject | undefined {
    const p = this.lastPalace;
    if (!p || p.interior || this.mode !== 'editor') return undefined;
    const id = useStore.getState().activeBuildingId;
    const b = id ? p.objects.find((o) => o.id === id) : undefined;
    return b && isInPlace(b) ? b : undefined;
  }

  /**
   * Budynek z wnętrzem w miejscu, w którym stoi gracz (spacer): rzut stóp w obrysie wnętrza i wysokość
   * między podłogą parteru a szczytem murów.
   */
  private insideBuilding(): PalaceObject | undefined {
    const p = this.lastPalace;
    if (!p || p.interior || this.mode === 'editor') return undefined;
    const x = this.rig.position.x;
    const z = this.rig.position.z;
    const footY = this.rig.position.y - this.headOffset;
    for (const b of p.objects) {
      if (!isInPlace(b)) continue;
      const spec = SHELLS[b.type];
      const [lx, lz] = localXZ(b, x, z);
      const inXZ = b.type === 'tower' ? Math.hypot(lx, lz) < TOWER_R : Math.abs(lx - spec.cx) < spec.inner.w / 2 && Math.abs(lz - spec.cz) < spec.inner.d / 2;
      if (!inXZ) continue;
      const y0 = buildingFloorY(b, 0);
      if (footY >= y0 - 0.4 && footY < y0 + Math.max(1, b.floors ?? 1) * buildingFloorHeight(b)) return b;
    }
    return undefined;
  }

  /** Budynek i piętro, na których stawiamy: w edytorze aktywny budynek i edytowane piętro, w spacerze ten, w którym stoi gracz. */
  private placeBuilding(): { b: PalaceObject; floor: number } | undefined {
    if (this.mode === 'editor') {
      const b = this.activeBuilding();
      return b ? { b, floor: useStore.getState().editFloor } : undefined;
    }
    const b = this.insideBuilding();
    return b ? { b, floor: floorOfIn(b, this.rig.position.y - this.headOffset) } : undefined;
  }

  /** Spacer: zapamiętuje budynek, w którym stoi gracz, i ustawia płaszczyznę stawiania na jego piętrze. */
  private updateInsideBuilding() {
    const pb = this.placeBuilding();
    useStore.getState().setInsideBuilding(pb?.b.id ?? null);
    this.groundPlane.constant = -(pb ? buildingFloorY(pb.b, pb.floor) : 0);
  }

  /** Wysokość podłogi, na której edytor stawia obiekty i rysuje ścianki. */
  private editFloorY(): number {
    return -this.groundPlane.constant;
  }

  /** Odświeża widoczność obiektów i stropów zależnie od edytowanego piętra (ściany rozstrzyga `frame()` co klatkę). */
  private applyFloorVisibility() {
    for (const e of this.entries.values()) e.group.visible = this.entryVisible(e);
    const active = this.activeBuilding();
    const editFloor = useStore.getState().editFloor;
    for (const e of this.entries.values()) {
      if (!e.inplace) continue;
      const on = active?.id === e.id;
      if (e.roof) e.roof.visible = !on;
      for (const s of e.slabs) s.visible = !on || (s.userData.slab as number) <= editFloor;
      if (!on) for (const w of e.walls) w.visible = true;
    }
    if (!this.room) return;
    const inEditor = this.mode === 'editor';
    this.room.slabs.forEach((s, k) => (s.visible = !inEditor || k <= editFloor));
    this.room.ceiling.visible = !inEditor;
  }

  /** Płaszczyzna pomocnicza do stawiania obiektów — na wysokości edytowanego piętra we wnętrzu. */
  private updateGroundPlane() {
    const p = this.lastPalace;
    const active = this.activeBuilding();
    const y = active ? buildingFloorY(active, useStore.getState().editFloor) : p?.interior ? useStore.getState().editFloor * floorHeightFor(p) : 0;
    this.groundPlane.constant = -y;
  }

  /** Buduje otoczenie sceny: wnętrze budynku albo plansza z terenem i pogodą. */
  private applyEnvironment(p: Palace, sceneChanged: boolean) {
    const isInterior = !!p.interior;
    let spec: (RoomSpec & { floors: number }) | null = null;
    let openings: Opening[][] = [];
    if (isInterior) {
      spec = roomSpecFor(p, useStore.getState().data.palaces);
      openings = stairOpenings(p.objects, spec.height);
    }
    const roomKey = isInterior && spec ? `${p.id}|${p.interior!.buildingType}|${spec.width}|${spec.depth}|${spec.floors}|${p.settings.wallTexture ?? ''}|${JSON.stringify(openings)}` : '';
    if (roomKey !== this.roomKey) {
      this.roomKey = roomKey;
      if (this.room) {
        this.scene.remove(this.room.group);
        this.room.dispose();
        this.room = null;
      }
      if (isInterior && spec) {
        const type = p.interior!.buildingType;
        this.room = buildRoom(spec, type, { floors: spec.floors, openings, wallTexture: p.settings.wallTexture });
        this.scene.add(this.room.group);
        this.physicsDirty = true; // powłoka się przebudowała
      }
      this.applyFloorVisibility();
    }

    if (isInterior) {
      this.ground.visible = false;
      this.slab.visible = false;
      this.grid.visible = false;
      if (this.terrain) this.terrain.group.visible = false;
      if (this.envKey !== 'interior') {
        this.envKey = 'interior';
        this.weather.apply('clear', p.settings.ambience, groundExtent(p.settings.ground), false);
        this.sounds.setEnvironment(p.settings.ambience === 'night', true);
        this.scene.background = new THREE.Color('#242a26');
        this.baseLight = { hemi: 0.5, ambient: 0.45, sun: 0.25 };
        this.ambienceFog = { color: '#242a26', near: 30, far: 90 };
        this.hemi.color.set('#cfd6e2');
        this.sun.color.set('#fff2dd');
        this.applyLighting();
      }
      const texKeyIn = `in|${p.settings.groundTexture ?? ''}|${this.roomKey}`;
      if (texKeyIn !== this.lastTextureKey) {
        this.lastTextureKey = texKeyIn;
        this.applyGroundTexture(p);
      }
      this.bounds = { hx: this.room?.bounds.hx ?? 5, hz: this.room?.bounds.hz ?? 5 };
      this.walkArea = { width: this.bounds.hx * 2 + 0.8, depth: this.bounds.hz * 2 + 0.8, shape: 'rect' };
      this.updateGroundPlane();
      return;
    }
    this.updateGroundPlane();

    // scena zewnętrzna
    this.ground.visible = true;
    this.slab.visible = true;
    // klucz musi objąć narysowane kafle, inaczej dorysowany kawałek planszy nie przebudowałby płyty ani kolizji
    const g = p.settings.ground;
    const holes = basementHoles(p.objects);
    // ćwierć metra zaokrąglenia: przeciąganie budynku z piwnicą nie przebudowuje płyty na każdą klatkę.
    // Zaokrąglamy raz i tego samego obrysu używamy do klucza i do geometrii, żeby po zatrzymaniu ruchu
    // otwór leżał dokładnie tam, gdzie mówi klucz
    const snap = (v: number) => Math.round(v * 4) / 4;
    const outlines = basementQuads(p.objects)
      .map((ring) => ring.map(([x, z]) => [snap(x), snap(z)] as [number, number]))
      .flatMap((ring) => clipToGround(ring, g));
    const holeKey = outlines.flat().map(([x, z]) => `${x}:${z}`).join(',');
    const shapeKey = `${g.shape}|${g.width}|${g.depth}|${(g.tiles ?? []).map((t) => t.join(':')).sort().join(',')}`;
    const groundKey = `${shapeKey}|${holeKey}`;
    if (this.lastGroundKey !== groundKey) {
      this.buildGround(p.settings.ground, holes, outlines);
      this.lastGroundKey = groundKey;
      this.lastTextureKey = '';
      this.physicsDirty = true; // zmieniony kształt płyty to inne kolidery pod nogami
    }
    // teren leży kilkanaście centymetrów pod zerem, czyli w środku każdej piwnicy, i bez wycięcia zamykałby ją
    // niewidzialną pokrywą. Same otwory podmieniamy bez liczenia szumu od nowa — inaczej przeciąganie budynku
    // z piwnicą przebudowywałoby cały pierścień terenu
    const terrainKey = `${p.settings.scenery}|${p.settings.seed}|${shapeKey}`;
    if (terrainKey !== this.terrainKey) {
      this.terrainKey = terrainKey;
      this.terrainHoleKey = holeKey;
      this.rebuildTerrain(p, outlines);
    } else if (holeKey !== this.terrainHoleKey) {
      this.terrainHoleKey = holeKey;
      this.terrain?.setHoles(outlines);
      this.physicsDirty = true; // wycięty teren to inna siatka kolizji pod nogami
    }
    if (this.terrain) this.terrain.group.visible = true;
    const envKey = `out|${p.settings.ambience}|${p.settings.weather}|${shapeKey}`;
    if (envKey !== this.envKey) {
      this.envKey = envKey;
      this.weather.apply(p.settings.weather, p.settings.ambience, groundExtent(p.settings.ground), true);
      this.weather.setCloudsVisible(!this.topView);
      this.applyAmbience(p.settings.ambience);
      this.sounds.setEnvironment(p.settings.ambience === 'night', false);
    }
    this.grid.visible = p.settings.grid;
    const texKey = `out|${p.settings.groundTexture ?? ''}|${shapeKey}|${p.settings.ambience}`;
    if (texKey !== this.lastTextureKey) {
      this.lastTextureKey = texKey;
      this.applyGroundTexture(p);
    }
    this.walkArea = p.settings.ground;
    const h = groundExtent(p.settings.ground) / 2 - 0.4;
    const gb = groundBounds(p.settings.ground);
    this.bounds = { hx: Math.max(gb.x1, -gb.x0) - 0.4, hz: Math.max(gb.z1, -gb.z0) - 0.4 };
    void h;
    void sceneChanged;
  }

  /**
   * Ustawia kamerę po przejściu drzwiami.
   * Wejście: tuż za progiem, twarzą w głąb pomieszczenia.
   * Wyjście: przed drzwiami budynku, twarzą na zewnątrz (plecami do drzwi).
   */
  private applySceneEntry(kind: 'enter' | 'exit', objectId: string) {
    if (kind === 'enter') {
      const spawn = this.room?.spawn;
      if (!spawn) {
        this.cameraCommand('center');
        return;
      }
      if (this.mode === 'editor') {
        // w edytorze patrzymy na pokój od strony drzwi, żeby widzieć to samo co gracz
        this.lookAtRoomFromDoor();
      } else {
        this.placeRig({ x: spawn.pos.x, z: spawn.pos.z, yaw: spawn.yaw });
      }
      return;
    }
    // wyjście: stajemy przed drzwiami budynku, twarzą od niego
    const e = objectId ? this.entries.get(objectId) : undefined;
    const o = objectId ? this.lastPalace?.objects.find((x) => x.id === objectId) : undefined;
    if (!e || !o) {
      this.cameraCommand('center');
      return;
    }
    const spec = DOORS[o.type]?.outside ?? [0, 0, 3];
    const world = e.group.localToWorld(tmpV.set(spec[0], spec[1], spec[2]));
    if (this.mode === 'editor') {
      // kamera nad punktem przed drzwiami, skierowana na budynek
      const target = new THREE.Vector3(e.group.position.x, Math.min(e.height * o.scale[1] * 0.5, 2.5), e.group.position.z);
      const back = new THREE.Vector3(world.x - target.x, 0, world.z - target.z).normalize().multiplyScalar(11);
      this.tween = {
        t: 0,
        dur: 0.8,
        fromPos: this.camera.position.clone(),
        toPos: target.clone().add(new THREE.Vector3(back.x, 8, back.z)),
        fromTarget: this.orbit.target.clone(),
        toTarget: target,
      };
      return;
    }
    // drzwi są w lokalnym +Z modelu, więc na zewnątrz patrzymy w kierunku +Z budynku
    this.placeRig({ x: this.clampX(world.x), z: this.clampZ(world.z), yaw: yawOfObject(o) + Math.PI });
  }

  /** Kadr edytora ustawiony jak spojrzenie od drzwi w głąb pokoju. */
  private lookAtRoomFromDoor() {
    const p = this.lastPalace;
    if (!p) return;
    const size = groundExtent(p.settings.ground);
    const editFloor = useStore.getState().editFloor;
    const center = new THREE.Vector3(0, editFloor * floorHeightFor(p) + 0.5, 0);
    const dist = Math.max(size * 0.78, 6) * 2.1;
    const dir = new THREE.Vector3(0.45, 1.5, 1).normalize();
    this.tween = {
      t: 0,
      dur: 0.7,
      fromPos: this.camera.position.clone(),
      toPos: center.clone().add(dir.multiplyScalar(dist)),
      fromTarget: this.orbit.target.clone(),
      toTarget: center,
    };
  }

  private syncObjects(p: Palace) {
    const seen = new Set<string>();
    // klucz przebudowy to typ i wszystko, od czego zależy model (wysokość kondygnacji, otwory, piętra)
    const buildKey = (o: PalaceObject) => `${o.type}|${JSON.stringify(this.modelCtx(o, p))}`;
    for (const o of p.objects) {
      seen.add(o.id);
      let e = this.entries.get(o.id);
      if (e && e.buildKey !== buildKey(o)) {
        this.removeEntry(e);
        e = undefined;
      }
      if (!e) {
        const key = buildKey(o);
        const model = buildModel(o.type, this.modelCtx(o, p));
        // pasma obrysu liczymy przed scaleniem: po nim wszystkie bryły o wspólnym materiale (cokół, tarasy,
        // gzymsy) są jedną siatką sięgającą od ziemi po szczyt i każde pasmo dostałoby obrys całej wieży
        const slices = modelSlices(model);
        // scalamy przed nadaniem `objectId`, bo scalane są tylko siatki bez własnego `userData`
        mergeByMaterial(model);
        const group = new THREE.Group();
        group.add(model);
        group.userData.objectId = o.id;
        group.traverse((c) => (c.userData.objectId = o.id));
        this.scene.add(group);
        const item = catalogItem(o.type);
        e = { id: o.id, type: o.type, group, model, height: modelHeight(model), footprint: item.footprint, label: null, labelEl: null, labelKey: '', panel: null, panelKey: '', transformKey: '', emitter: null, buildKey: key, inplace: isInPlace(o), roof: null, slabs: [], walls: [], lights: [], parts: new Map(), bounds: modelBounds(model), slices };
        model.traverse((c) => {
          const l = c as THREE.PointLight;
          if (!l.isPointLight) return;
          l.userData.baseIntensity = l.intensity;
          l.visible = false; // świeci za nie miejsce w puli; widoczne źródło zmieniałoby liczbę świateł w shaderze
          e!.lights.push(l);
        });
        // drzwi z Konstrukcji i budynki z wnętrzem w miejscu mają otwierane skrzydło; zagnieżdżone budynki nie (F wchodzi do środka)
        if (o.type === 'door' || e.inplace) model.traverse((c) => { if (c.userData.doorLeaf) e!.doorPivot = c as THREE.Group; });
        const assetMount = ASSET_MOUNTS[o.type];
        if (assetMount) {
          if (model.userData.asset === 0) this.ensureAsset(assetMount.file);
          else {
            const root = model.userData.assetModel as THREE.Object3D;
            const clips = assetLoaded(assetMount.file)?.clips ?? [];
            e.anim = { mixer: new THREE.AnimationMixer(root), clips, current: null, action: null };
            this.playClip(e, assetMount.clips.idle, 1);
            // kości po nazwie: siodło jedzie za tułowiem, który animacja kołysze
            root.traverse((c) => {
              if ((c as THREE.Bone).isBone) e!.parts.set(c.name, c);
            });
          }
        }
        if (isMount(o.type)) {
          model.traverse((c) => {
            if (typeof c.userData.rig !== 'string') return;
            e!.parts.set(c.userData.rig, c);
            // poza jazdą część wraca do pozy z budowy (uniesiona głowa czerwia, złożone skrzydła)
            c.userData.rest ??= [c.position.x, c.position.y, c.position.z, c.rotation.x, c.rotation.y, c.rotation.z];
          });
        }
        if (e.inplace) {
          model.traverse((c) => {
            if (c.userData.roof) e!.roof = c;
            if (c.userData.slab !== undefined) e!.slabs.push(c);
            if (c.userData.wallNormal) e!.walls.push(c as THREE.Mesh);
          });
        }
        if (item.emitter) {
          const anchor = EMITTER_ANCHORS[o.type] ?? [0, e.height, 0];
          e.emitter =
            item.emitter === 'smoke'
              ? new PuffEmitter({ count: 22, origin: anchor, radius: 0.4, rise: 1.9, life: 3.8, scaleFrom: 0.3, scaleTo: 1.15, color: '#b3aca6', opacity: 0.34, drift: [0.4, 0.14] })
              : item.emitter === 'mist'
                ? new PuffEmitter({ count: 16, origin: anchor, radius: 0.4, rise: 0.45, life: 1.6, scaleFrom: 0.12, scaleTo: 0.42, color: '#ffffff', opacity: 0.26 })
                : item.emitter === 'fire'
                  // oddech smoka: suchy ogień do przodu (−Z), widoczny tylko gdy jeździec każe zionąć (`animateMount`)
                  ? new PuffEmitter({ count: 14, origin: anchor, radius: 0.1, rise: 0.12, life: 0.65, scaleFrom: 0.07, scaleTo: 0.42, color: '#ff7a28', emissive: '#ff3a00', opacity: 0, drift: [0, -2.4] })
                  : item.emitter === 'sand'
                    // kłęby piasku spod czerwia: gęstnieją z prędkością, na postoju znikają
                    ? new PuffEmitter({ count: 24, origin: anchor, radius: 0.9, rise: 0.6, life: 1.4, scaleFrom: 0.4, scaleTo: 2.2, color: '#c9a36b', opacity: 0, drift: [0, 1.5] })
                : item.emitter === 'fireflies'
                  ? new SwarmEmitter({ count: 26, origin: [0, 0.4, 0], radius: 2.2, height: 1.6, kind: 'firefly', colors: ['#d8ff7a', '#f4ffb0', '#b8f060'], size: 0.09, speed: 0.8 })
                  : item.emitter === 'insects'
                    ? new SwarmEmitter({ count: 40, origin: [0, 0.5, 0], radius: 1.2, height: 1.0, kind: 'insect', colors: ['#e8b93c', '#3a2e1c', '#d9a72e'], size: 0.045, speed: 1.0 })
                    : new SwarmEmitter({ count: 12, origin: [0, 0.5, 0], radius: 2.0, height: 1.2, kind: 'butterfly', colors: ['#f2b64c', '#e88a8a', '#8fb7e6', '#f6f0d8', '#c9a2d8'], size: 0.14, speed: 1.0 });
          e.emitter.object.userData.noPick = true;
          e.group.add(e.emitter.object);
        }
        this.entries.set(o.id, e);
      }
      const scaleKey = o.scale.join(':');
      const tk = `${o.position.join(',')}|${o.rotation.join(',')}|${scaleKey}`;
      if (tk !== e.transformKey) {
        const prevScaleKey = e.transformKey.split('|')[2] ?? '';
        const isNew = e.transformKey === '';
        e.transformKey = tk;
        e.group.position.set(o.position[0], o.position[1], o.position[2]);
        e.group.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
        e.group.scale.set(o.scale[0], o.scale[1], o.scale[2]);
        if (this.physics) {
          // sama zmiana położenia nie wymaga przeliczania siatki kolizji
          if (!isNew && prevScaleKey === scaleKey && this.physics.moveStatic(o.id, e.group.position, e.group.quaternion)) {
            if (e.doorPivot) this.physics.moveStatic(o.id + ':leaf', e.group.position, e.group.quaternion);
          } else {
            this.physics.setStatic(o.id, this.shapeFor(e), e.group.position, e.group.quaternion, e.group.scale);
            if (e.doorPivot) this.physics.setLeaf(o.id, !this.openDoors.has(o.id), e.group.position, e.group.quaternion, e.group.scale, leafFor(o.type));
          }
        } else this.physicsDirty = true;
      }
    }
    for (const [id, e] of this.entries) if (!seen.has(id)) this.removeEntry(e);
    this.obstacleCache = null;
  }

  /**
   * Kontekst budowy modelu obiektu: ścianki, drzwi, schody i lampy w budynku z wnętrzem w miejscu mają
   * wysokość jego kondygnacji; ścianka zależy od skali X i otworów na drzwi; budynek od pięter i otworów w stropach.
   */
  private modelCtx(o: PalaceObject, p: Palace): Partial<BuildCtx> {
    const b = buildingOf(p.objects, o);
    const floorHeight = Math.round((b ? buildingFloorHeight(b) : floorHeightFor(p)) * 1000) / 1000;
    const base: Partial<BuildCtx> = { floorHeight };
    if (o.colors && Object.keys(o.colors).length) base.colors = o.colors;
    if (o.type === 'wall') return { ...base, scaleX: o.scale[0], openings: doorOffsets(o, p.objects).map((t) => Math.round(t * 100) / 100) };
    if (isInPlace(o)) return { ...base, floors: o.floors ?? 1, basement: !!o.basement, scaleY: Math.round(o.scale[1] * 100) / 100, slabOpenings: buildingOpenings(o, p.objects), facade: facadeHoles(o, p.objects), finish: o.finish };
    if (o.type === 'pathway') return { ...base, scaleX: o.scale[0], scaleZ: o.scale[2], finish: o.finish };
    // taras: schodki od podłogi parteru do ziemi
    if (o.type === 'terrace' && b) return { ...base, drop: Math.round((buildingFloorY(b, 0) - b.position[1]) * 100) / 100 };
    if (o.type === 'painting') return { ...base, variant: hashString(o.id) % ART_VARIANTS };
    // model z pliku: klucz zmienia się, gdy plik dojedzie, i wpis buduje się na nowo z prawdziwą siatką
    if (ASSET_MOUNTS[o.type]) return { ...base, asset: assetLoaded(ASSET_MOUNTS[o.type].file) ? 1 : 0 };
    // regał i stos książek: układ tomów z ziarna obiektu
    if (o.type === 'shelf' || o.type === 'books') return { ...base, variant: hashString(o.id) % 1000 };
    if (o.type === 'skyscraper' || o.type === 'megatower' || o.type === 'billboard' || o.type === 'neon' || o.type === 'block') return { ...base, variant: hashString(o.id) % 1000 };
    return base;
  }

  /** Model z pliku dojeżdża w tle; po wczytaniu wpisy tego typu przebudowują się przez zmianę klucza budowy. */
  private ensureAsset(file: string) {
    if (this.assetLoads.has(file)) return;
    this.assetLoads.add(file);
    this.pendingLoads.add(`asset:${file}`);
    loadAsset(file)
      .then(() => {
        if (this.disposed || !this.lastPalace) return;
        this.syncObjects(this.lastPalace);
      })
      .catch((err) => console.warn('Nie udało się wczytać modelu', file, err))
      .finally(() => this.pendingLoads.delete(`asset:${file}`));
  }

  /** Przełącza klip z krótkim przenikaniem; ten sam klip tylko zmienia tempo. */
  private playClip(e: Entry, name: string, timeScale: number) {
    const a = e.anim;
    if (!a) return;
    if (a.current !== name) {
      const clip = findClip(a.clips, name);
      if (!clip) return;
      const next = a.mixer.clipAction(clip);
      next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
      a.action?.fadeOut(0.25);
      a.action = next;
      a.current = name;
    }
    if (a.action) a.action.timeScale = timeScale;
  }

  private removeEntry(e: Entry) {
    if (this.ride?.id === e.id) this.cancelRide();
    if (e.anim) {
      e.anim.mixer.stopAllAction();
      e.anim.mixer.uncacheRoot(e.anim.mixer.getRoot() as THREE.Object3D);
      e.anim = undefined;
    }
    if (e.label) {
      e.group.remove(e.label);
      e.label.element.remove();
      e.label = null;
      e.labelEl = null;
    }
    if (e.emitter) {
      e.emitter.dispose();
      e.emitter = null;
    }
    this.physics?.removeStatic(e.id);
    if (e.doorPivot) this.physics?.removeStatic(e.id + ':leaf');
    this.openDoors.delete(e.id);
    this.scene.remove(e.group);
    disposeObject(e.group);
    if (e.panel) {
      this.scene.remove(e.panel);
      disposeTextPanel(e.panel);
      e.panel = null;
    }
    this.entries.delete(e.id);
  }

  private syncPath(p: Palace) {
    if (this.pathLine) {
      this.scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      (this.pathLine.material as THREE.Material).dispose();
      this.pathLine = null;
    }
    this.pathDots.clear();
    const byId = new Map(p.objects.map((o) => [o.id, o]));
    const pts = p.path.map((id) => byId.get(id)).filter((o): o is PalaceObject => !!o).map((o) => new THREE.Vector3(o.position[0], o.position[1] + 0.04, o.position[2]));
    if (pts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(pts.length * 24));
      const m = new THREE.LineDashedMaterial({ color: '#c4703f', dashSize: 0.35, gapSize: 0.22, linewidth: 1 });
      const line = new THREE.Line(geo, m);
      line.computeLineDistances();
      this.pathLine = line;
      this.scene.add(line);
    }
    for (const pt of pts) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshBasicMaterial({ color: '#c4703f' }));
      dot.rotation.x = -Math.PI / 2;
      dot.position.copy(pt).setY(pt.y - 0.01);
      this.pathDots.add(dot);
    }
    const show = p.settings.showPath;
    if (this.pathLine) this.pathLine.visible = show;
    this.pathDots.visible = show;
  }

  private refreshLabels(p: Palace) {
    const review = useStore.getState().review;
    for (const o of p.objects) {
      const e = this.entries.get(o.id);
      if (!e) continue;
      const idx = p.path.indexOf(o.id);
      const hasNote = !!o.note;
      const cur = review?.stops[review.index];
      const current = !!cur && cur.objectId === o.id && cur.palaceId === p.id;
      const key = hasNote ? `${idx}|${o.name}|${current}|${this.mode}` : '';
      if (key === e.labelKey) continue;
      e.labelKey = key;
      if (e.label) {
        e.group.remove(e.label);
        e.label.element.remove();
        e.label = null;
        e.labelEl = null;
      }
      if (!hasNote || this.mode !== 'editor') continue;
      const el = document.createElement('div');
      el.className = 'obj-label' + (current ? ' current' : '');
      el.innerHTML = `${idx >= 0 ? `<span class="num">${idx + 1}</span>` : '<span class="num dot"></span>'}<span class="txt"></span>`;
      (el.querySelector('.txt') as HTMLSpanElement).textContent = o.name;
      el.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        if (ev.shiftKey) useStore.getState().toggleSelected(o.id);
        else useStore.getState().select(o.id);
      });
      const lbl = new CSS2DObject(el);
      lbl.position.set(0, e.height + 0.5 / Math.max(o.scale[1], 0.01), 0);
      e.group.add(lbl);
      e.label = lbl;
      e.labelEl = el;
    }
  }

  /** Panele tekstowe 3D (widok z oczu / VR). */
  private refreshPanels(p: Palace) {
    const st = useStore.getState();
    const review = st.review;
    const show3d = this.mode !== 'editor';
    for (const o of p.objects) {
      const e = this.entries.get(o.id);
      if (!e) continue;
      const idx = p.path.indexOf(o.id);
      const cur = review?.stops[review.index];
      const current = !!cur && cur.objectId === o.id && cur.palaceId === p.id;
      const revealed = current && review?.revealed;
      let key = '';
      if (show3d && o.note) key = `${o.name}|${idx}|${current}|${revealed}|${o.note.title}|${o.note.body.length}|${o.note.updatedAt}`;
      if (key === e.panelKey) continue;
      e.panelKey = key;
      if (e.panel) {
        this.scene.remove(e.panel);
        disposeTextPanel(e.panel);
        e.panel = null;
      }
      if (!key || !o.note) continue;
      let panel: THREE.Mesh;
      if (current) {
        const text = revealed
          ? `${o.note.body}\n\nKliknij / naciśnij, aby przejść dalej.`
          : `Co tu zostawiłeś?\n\nKliknij / naciśnij, aby odsłonić notatkę.`;
        panel = makeTextPanel(text, { title: revealed ? `${idx >= 0 ? idx + 1 + '. ' : ''}${o.name} — ${o.note.title}` : `${idx >= 0 ? idx + 1 + '. ' : ''}${o.name}`, width: 2.2, fontSize: 30, bg: revealed ? 'rgba(255,253,246,0.96)' : 'rgba(47,90,60,0.94)', color: revealed ? '#20302a' : '#f4f7ef' });
      } else {
        panel = makeTextPanel(o.note.title, { title: `${idx >= 0 ? idx + 1 + '. ' : ''}${o.name}`, width: 1.3, fontSize: 34, align: 'center', maxLines: 2 });
      }
      panel.userData.objectId = o.id;
      panel.userData.current = current;
      this.scene.add(panel);
      e.panel = panel;
    }
  }

  private applySelection(ids: string[], hover: string | null) {
    this.placeRings(ids, hover);
    this.syncGizmo();
    // podświetlenie
    const chosen = new Set(ids);
    for (const [id, e] of this.entries) {
      const on = chosen.has(id);
      e.model.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (on && !m.userData.hl) {
          m.userData.orig = mat;
          const clone = mat.clone();
          clone.emissive = new THREE.Color('#2f5a3c');
          clone.emissiveIntensity = 0.18;
          m.material = clone;
          m.userData.hl = true;
        } else if (!on && m.userData.hl) {
          (m.material as THREE.Material).dispose();
          m.material = m.userData.orig;
          m.userData.hl = false;
        }
      });
    }
  }

  /** Pierścienie pod zaznaczonymi i najechanym obiektem; wołane też po każdej zmianie pałacu, żeby szły za uchwytem. */
  private placeRings(ids: string[], hover: string | null) {
    const place = (ring: THREE.Mesh, id: string | null) => {
      const e = id ? this.entries.get(id) : undefined;
      if (!e) {
        ring.visible = false;
        return;
      }
      ring.visible = this.mode === 'editor';
      ring.position.x = e.group.position.x;
      ring.position.z = e.group.position.z;
      ring.position.y = e.group.position.y + (ring === this.hoverRing ? 0.015 : 0.02);
      const r = (e.footprint + 0.5) * hs(e);
      ring.scale.setScalar(r);
    };
    while (this.selRings.length < ids.length) {
      const ring = new THREE.Mesh(this.selRing.geometry, this.selRing.material);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.scene.add(ring);
      this.selRings.push(ring);
    }
    this.selRings.forEach((ring, i) => place(ring, ids[i] ?? null));
    place(this.hoverRing, hover && !ids.includes(hover) ? hover : null);
  }

  // ---------- tryby ----------
  /** Fizyka ładuje się dopiero przy pierwszym wejściu w tryb chodzenia (osobna paczka WASM). */
  private ensurePhysics() {
    if (this.physics || this.physicsLoading) {
      if (this.physics && this.physicsDirty) this.rebuildPhysics();
      return;
    }
    this.physicsLoading = true;
    this.pendingLoads.add('physics');
    Physics.load()
      .then((p) => {
        this.physicsLoading = false;
        this.pendingLoads.delete('physics');
        if (this.disposed) {
          p.dispose();
          return;
        }
        this.physics = p;
        this.rebuildPhysics();
      })
      .catch((err) => {
        this.physicsLoading = false;
        this.pendingLoads.delete('physics');
        console.error(err);
        useStore.getState().showToast('Nie udało się wczytać fizyki — chodzenie działa w trybie uproszczonym.');
      });
  }

  /** Odbudowuje świat fizyki dla bieżącej sceny. */
  /** Podgląd brył kolizji: ?physdebug=1 w adresie. */
  private updatePhysicsDebug() {
    if (!this.physics) return;
    if (!this.physicsDebug) {
      const geo = new THREE.BufferGeometry();
      const m = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
      this.physicsDebug = new THREE.LineSegments(geo, m);
      this.physicsDebug.frustumCulled = false;
      this.physicsDebug.renderOrder = 20;
      this.scene.add(this.physicsDebug);
    }
    const b = this.physics.debugBuffers();
    const geo = this.physicsDebug.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(b.vertices, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.colors.length / 4 * 3).map((_, i) => b.colors[Math.floor(i / 3) * 4 + (i % 3)]), 3));
  }

  private rebuildPhysics() {
    const ph = this.physics;
    const p = this.lastPalace;
    if (!ph || !p) return;
    ph.reset();
    if (p.interior) {
      ph.setRoom(this.room?.colliders ?? null, this.room?.trimeshes ?? []);
    } else {
      const holes = basementHoles(p.objects);
      if (isDrawnGround(p.settings.ground) || holes.length > 0) {
        ph.setGroundParts(holes.reduce((acc, h) => subtractRect(acc, h), groundRects(p.settings.ground)), 0.6);
      } else ph.setGroundShape(groundPolygon(p.settings.ground), 0.6);
      ph.setTerrain(this.terrain?.mesh ?? null);
    }
    for (const [id, e] of this.entries) {
      const o = p.objects.find((x) => x.id === id);
      if (!o) continue;
      ph.setStatic(id, this.shapeFor(e), e.group.position, e.group.quaternion, e.group.scale);
      if (e.doorPivot) ph.setLeaf(id, !this.openDoors.has(id), e.group.position, e.group.quaternion, e.group.scale, leafFor(o.type));
    }
    ph.createCharacter(this.rig.position);
    this.physicsDirty = false;
  }

  private shapeFor(e: Entry): StaticShape {
    const kind = colliderKind(e.type);
    if (kind === 'cylinder') return { kind, cylinder: { r: Math.max(e.footprint * 0.3, 0.2), h: e.height } };
    return { kind, object: e.model };
  }

  /** Zapisuje do stanu pozycję i obrót ustawione uchwytem. */
  private onGizmoChange() {
    const obj = this.gizmo.object as THREE.Group | undefined;
    if (!obj) return;
    const y = Math.max(0, obj.position.y);
    obj.position.y = y;
    if (obj === this.pivot) {
      const ms = this.multiStart;
      if (!ms) return;
      // każdy obiekt zachowuje swoje położenie względem pivota, obracanego wokół osi pionowej
      const dRot = obj.rotation.y;
      const cos = Math.cos(dRot);
      const sin = Math.sin(dRot);
      const list = ms.items.map((it) => {
        const rx = it.pos[0] - ms.pos.x;
        const rz = it.pos[2] - ms.pos.z;
        const position: Vec3 = [obj.position.x + rx * cos + rz * sin, it.pos[1] + (y - ms.pos.y), obj.position.z - rx * sin + rz * cos];
        return { id: it.id, patch: { position, rotation: [it.rotation[0], it.rotation[1] + dRot, it.rotation[2]] as Vec3 } };
      });
      useStore.getState().updateObjects(list, { undo: false });
      return;
    }
    const id = obj.userData.objectId as string | undefined;
    if (!id) return;
    const st = useStore.getState();
    const o = st.palace().objects.find((x) => x.id === id);
    if (o && isFacade(o.type)) {
      const found = this.findFacadeFor(o.type, obj.position.x, obj.position.z, o.anchorId);
      const floor = found ? floorOfIn(found.b, o.position[1]) : 0;
      if (!found?.hit || !facadeFloorOk(o.type, floor)) {
        obj.position.set(o.position[0], o.position[1], o.position[2]);
        obj.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
        return;
      }
      obj.position.set(found.hit.x, buildingFloorY(found.b, floor), found.hit.z);
      obj.rotation.set(0, found.hit.yaw, 0);
      st.updateObject(id, { position: [found.hit.x, buildingFloorY(found.b, floor), found.hit.z], rotation: [0, found.hit.yaw, 0], anchorId: found.b.id }, { undo: false });
      return;
    }
    if (o?.type === 'door') {
      // drzwi nie opuszczają ścianki: pozycja rzutowana na jej oś, obrót zawsze ze ścianki
      const hit = this.findWallFor(obj.position.x, obj.position.z, o.anchorId);
      if (!hit) {
        obj.position.set(o.position[0], o.position[1], o.position[2]);
        obj.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
        return;
      }
      const yaw = doorYawOn(hit.wall, o);
      obj.position.set(hit.x, hit.wall.position[1], hit.z);
      obj.rotation.set(0, yaw, 0);
      st.updateObject(id, { position: [hit.x, hit.wall.position[1], hit.z], rotation: [0, yaw, 0], anchorId: hit.wall.id }, { undo: false });
      return;
    }
    st.updateObject(id, { position: [obj.position.x, y, obj.position.z], rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z] }, { undo: false });
  }

  /** Początek przeciągania pivota: zapamiętujemy, skąd startują zaznaczone obiekty. */
  private onGizmoMouseDown() {
    if (this.gizmo.object !== this.pivot || !this.lastPalace) return;
    const roots = movableRoots(this.lastPalace.objects, useStore.getState().selectedIds);
    this.multiStart = { pos: this.pivot.position.clone(), items: roots.map((o) => ({ id: o.id, pos: [...o.position] as Vec3, rotation: [...o.rotation] as Vec3 })) };
  }

  /** Półprzezroczysty podgląd elementu wybranego z biblioteki. */
  private setGhost(placing: { type: string; ids?: string[]; setId?: string } | null) {
    const key = placingKey(placing);
    if (this.ghostKey === key) return;
    this.ghostKey = key;
    const type = placing?.type ?? null;
    this.ghostType = type ?? '';
    this.ghostIds = placing?.ids ?? null;
    this.ghostSet = placing?.setId ? furnitureSet(placing.setId, useStore.getState().customSets) ?? null : null;
    this.ghostAutoRot = true;
    if (this.ghost) {
      this.scene.remove(this.ghost);
      disposeObject(this.ghost);
      this.ghost.traverse((c) => {
        const m = c as THREE.Mesh;
        const mat = m.material as THREE.Material | undefined;
        if (mat && m.userData.ghostMat) mat.dispose();
      });
      this.ghost = null;
    }
    if (this.ghostRing) {
      this.scene.remove(this.ghostRing);
      this.ghostRing.geometry.dispose();
      (this.ghostRing.material as THREE.Material).dispose();
      this.ghostRing = null;
    }
    this.clearWallDraw();
    this.doorFlip = false;
    this.ghostBlocked = false;
    this.renderer.domElement.style.cursor = type ? 'crosshair' : '';
    if (!type) return;

    const g = new THREE.Group();
    const p = this.lastPalace;
    // zestaw materializujemy wokół zera — dalej idzie tą samą drogą co szablon kopii
    const sources = this.ghostSet ? instantiateSet(this.ghostSet) : this.ghostIds && p ? p.objects.filter((o) => this.ghostIds!.includes(o.id)) : [];
    if (sources.length > 0 && p) {
      // szablon kopii: modele oryginałów w ich wzajemnym układzie, środek pod kursorem
      const inSource = new Set(sources.map((o) => o.id));
      const roots = sources.filter((o) => !o.anchorId || !inSource.has(o.anchorId));
      // zestaw ma własny punkt wstawienia (środek obrysu), a `placeSet` liczy od niego — podgląd nie może
      // przesuwać go o środek ciężkości, bo meble lądowałyby gdzie indziej, niż pokazuje duch
      const cx = this.ghostSet ? 0 : roots.reduce((a, o) => a + o.position[0], 0) / roots.length;
      const cz = this.ghostSet ? 0 : roots.reduce((a, o) => a + o.position[2], 0) / roots.length;
      const baseY = this.ghostSet ? 0 : Math.min(...roots.map((o) => o.position[1]));
      this.ghostFootprint = 0.4;
      for (const src of sources) {
        const model = buildModel(src.type, this.modelCtx(src, p));
        const wrap = new THREE.Group();
        wrap.add(model);
        // pojedyncze drzwi dostają obrót ze ścianki pod kursorem, więc szablon nie wnosi własnego obrotu
        const single = type === 'door';
        wrap.position.set(single ? 0 : src.position[0] - cx, single ? 0 : src.position[1] - baseY, single ? 0 : src.position[2] - cz);
        wrap.rotation.set(src.rotation[0], single ? 0 : src.rotation[1], src.rotation[2]);
        wrap.scale.set(src.scale[0], src.scale[1], src.scale[2]);
        g.add(wrap);
        const e = this.entries.get(src.id);
        // obiekty zestawu nie mają jeszcze wpisu w scenie — zasięg liczymy z katalogu
        const own = e ? e.footprint * hs(e) : catalogItem(src.type).footprint * Math.max(src.scale[0], src.scale[2]);
        const reach = Math.hypot(wrap.position.x, wrap.position.z) + own;
        this.ghostFootprint = Math.max(this.ghostFootprint, reach);
      }
    } else {
      const pb = this.placeBuilding();
      g.add(buildModel(type, { floorHeight: pb ? buildingFloorHeight(pb.b) : floorHeightFor(p) }));
      this.ghostFootprint = catalogItem(type).footprint;
    }
    g.traverse((c) => {
      const light = c as THREE.PointLight;
      if (light.isPointLight) light.visible = false; // podgląd nie świeci i nie zmienia liczby świateł w shaderze
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial;
      const clone = src.clone();
      clone.transparent = true;
      clone.opacity = 0.55;
      clone.depthWrite = false;
      m.material = clone;
      m.userData.ghostMat = true;
      m.castShadow = false;
      m.receiveShadow = false;
    });
    this.ghost = g;
    this.scene.add(g);

    const fp = this.ghostFootprint;
    this.ghostRing = new THREE.Mesh(
      new THREE.RingGeometry(fp + 0.2, fp + 0.36, 48),
      new THREE.MeshBasicMaterial({ color: '#3f7550', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.ghostRing);
    this.ghostRot = 0;
    if (isDrawn(type) && !this.ghostIds) {
      // ścianka nie ma sensownego pierścienia — długość pokazuje etykieta przy podglądzie
      this.ghostRing.visible = false;
      useStore.getState().showToast('Kliknij, gdzie ściana ma się zacząć.');
    }
    this.updateGhost();
  }

  /** Kończy rysowanie ścianki: kasuje początek i etykietę długości. */
  /** Tryb rysowania odcinków (ścianka albo ścieżka z biblioteki, nie kopia). */
  private drawing(): boolean {
    return isDrawn(this.ghostType) && !this.ghostIds;
  }

  private clearWallDraw() {
    this.wallStart = null;
    this.wallLen = 0;
    this.wallStartedOnDown = false;
    this.lastWallId = null;
    this.drawGroupId = null;
    if (this.wallLabel) {
      this.wallLabel.element.remove();
      this.wallLabel.removeFromParent();
      this.wallLabel = null;
    }
  }

  /** Ścianki na edytowanym piętrze (do przyciągania końców i drzwi). */
  private wallsOnEditFloor(type = 'wall'): PalaceObject[] {
    const p = this.lastPalace;
    if (!p) return [];
    // ścieżki leżą tylko na ziemi planszy
    if (type === 'pathway') return p.objects.filter((o) => o.type === 'pathway');
    const H = floorHeightFor(p);
    const editFloor = useStore.getState().editFloor;
    const pb = this.placeBuilding();
    // przy aktywnym budynku liczą się jego ścianki na edytowanym piętrze; wolno stojące ścianki planszy zawsze
    const free = p.objects.filter((o) => o.type === 'wall' && !buildingOf(p.objects, o) && floorOf(o.position[1], H) === (pb ? 0 : editFloor));
    if (!pb) return free;
    return [...p.objects.filter((o) => o.type === 'wall' && buildingOf(p.objects, o)?.id === pb.b.id && floorOfIn(pb.b, o.position[1]) === pb.floor), ...free];
  }

  /**
   * Ścianka, w której mogą stanąć drzwi wskazane w punkcie (x, z): najbliższa oś w promieniu 0,6 m.
   * `preferId` (kotwica przeciąganych drzwi) wygrywa przy równej odległości. Zwraca punkt na osi.
   */
  private findWallFor(x: number, z: number, preferId?: string, radius = 0.6): { wall: PalaceObject; t: number; x: number; z: number } | null {
    let best: { wall: PalaceObject; t: number; dist: number } | null = null;
    for (const wall of this.wallsOnEditFloor()) {
      const { t, dist } = wallOffsetOf(wall, x, z);
      const range = doorRange(wall);
      if (dist > radius || Math.abs(t) > range + 0.4 || wallLength(wall) < DOOR_SLOT) continue;
      const score = dist - (wall.id === preferId ? 0.05 : 0);
      if (!best || score < best.dist) best = { wall, t: Math.max(-range, Math.min(range, Math.round(t / 0.05) * 0.05)), dist: score };
    }
    if (!best) return null;
    const [px, pz] = wallPointAt(best.wall, best.t);
    return { wall: best.wall, t: best.t, x: px, z: pz };
  }

  /** Punkt rysowanej ścianki: siatka, końce i osie innych ścianek, lico ściany obwodowej, kąt co 15°. */
  private snapWallPoint(x: number, z: number, from: THREE.Vector3 | null): { x: number; z: number } {
    const st = useStore.getState();
    const snap = st.palace().settings.grid ? 0.5 : 0.05;
    let px = Math.round(x / snap) * snap;
    let pz = Math.round(z / snap) * snap;
    let snapped = false;
    const walls = this.wallsOnEditFloor(this.ghostType);
    // końce innych ścianek: styk bez szczeliny
    let bestD = 0.35;
    for (const w of walls) {
      for (const t of [-wallLength(w) / 2, wallLength(w) / 2]) {
        const [ex, ez] = wallPointAt(w, t);
        const d = Math.hypot(ex - x, ez - z);
        if (d < bestD) {
          bestD = d;
          px = ex;
          pz = ez;
          snapped = true;
        }
      }
    }
    if (!snapped) {
      // oś innej ścianki: połączenie w T
      for (const w of walls) {
        const { t, dist } = wallOffsetOf(w, x, z);
        if (dist < 0.3 && Math.abs(t) <= wallLength(w) / 2) {
          [px, pz] = wallPointAt(w, t);
          snapped = true;
          break;
        }
      }
    }
    if (this.room) {
      // lico ściany obwodowej: koniec ścianki chowa się w murze zamiast stykać się z nim płaszczyzną
      const faceX = this.bounds.hx + 0.35;
      const faceZ = this.bounds.hz + 0.35;
      if (Math.abs(x) > faceX - 0.4) {
        px = Math.sign(x) * (faceX + WALL_THICKNESS / 2);
        snapped = true;
      }
      if (Math.abs(z) > faceZ - 0.4) {
        pz = Math.sign(z) * (faceZ + WALL_THICKNESS / 2);
        snapped = true;
      }
    }
    if (from && !snapped) {
      const dx = px - from.x;
      const dz = pz - from.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.01) {
        const step = Math.PI / 12;
        const a = Math.round(Math.atan2(-dz, dx) / step) * step;
        px = from.x + Math.cos(a) * len;
        pz = from.z - Math.sin(a) * len;
      }
    }
    return { x: px, z: pz };
  }

  /** Podgląd ścianki: słupek przed pierwszym kliknięciem, potem odcinek od początku do kursora. */
  private updateWallGhost() {
    if (!this.ghost) return;
    const gp = new THREE.Vector3();
    if (!this.groundPoint(gp)) return;
    const isPath = this.ghostType === 'pathway';
    const floorY = isPath ? 0 : this.editFloorY();
    const p = this.snapWallPoint(gp.x, gp.z, this.wallStart);
    this.ghostAnchor = undefined;
    if (!this.wallStart) {
      this.ghost.position.set(p.x, floorY, p.z);
      this.ghost.rotation.y = 0;
      this.ghost.scale.x = WALL_THICKNESS / WALL_SEGMENT;
      this.ghostPos.set(p.x, floorY, p.z);
      this.wallLen = 0;
      return;
    }
    const dx = p.x - this.wallStart.x;
    const dz = p.z - this.wallStart.z;
    const len = Math.hypot(dx, dz);
    this.wallLen = len;
    const rot = len > 0.01 ? Math.atan2(-dz, dx) : 0;
    const mid = new THREE.Vector3(this.wallStart.x + dx / 2, floorY, this.wallStart.z + dz / 2);
    this.ghost.position.copy(mid);
    this.ghost.rotation.y = rot;
    this.ghost.scale.x = Math.max(len, WALL_THICKNESS) / WALL_SEGMENT;
    // końce ścieżki w podglądzie zostają kołami mimo rozciągania podglądu wzdłuż X
    if (isPath) this.ghost.traverse((c) => { if (c.userData.pathCap) c.scale.x = 1 / this.ghost!.scale.x; });
    this.ghostPos.copy(mid);
    this.ghostRot = rot;
    if (!this.wallLabel) {
      const el = document.createElement('div');
      el.className = 'wall-len';
      this.wallLabel = new CSS2DObject(el);
      this.scene.add(this.wallLabel);
    }
    this.wallLabel.element.textContent = `${len.toFixed(1).replace('.', ',')} m`;
    this.wallLabel.position.set(mid.x, floorY + (isPath ? 0.6 : floorHeightFor(this.lastPalace) + 0.3), mid.z);
  }

  /** Pierwsze kliknięcie w trybie ścianki: zapamiętuje początek odcinka. */
  private startWall() {
    if (!this.ghost) return;
    this.wallStart = this.ghostPos.clone();
    this.wallStartedOnDown = true;
    useStore.getState().showToast(`Kliknij, gdzie ${this.ghostType === 'pathway' ? 'ścieżka' : 'ściana'} ma się skończyć. Shift — kolejna od tego miejsca, Esc — anuluj.`);
    this.updateGhost();
  }

  /** Drugie kliknięcie: stawia ściankę od początku do bieżącego punktu. */
  private commitWall(keepPlacing: boolean) {
    const st = useStore.getState();
    if (!this.wallStart) {
      this.startWall();
      return;
    }
    if (this.wallLen < 0.5) return;
    const end = new THREE.Vector3(this.wallStart.x + Math.cos(this.ghostRot) * this.wallLen, this.ghostPos.y, this.wallStart.z - Math.sin(this.ghostRot) * this.wallLen);
    if (this.ghostType === 'pathway') {
      // ścieżka nie ma kotwicy; scalanie obejmuje wszystkie ścieżki na planszy, także te z poprzednich sesji
      const id = st.addObject('pathway', [this.ghostPos.x, 0, this.ghostPos.z], this.ghostRot, undefined, [this.wallLen / WALL_SEGMENT, 1, 1]);
      st.mergePaths({ undo: false });
      this.lastWallId = st.palace().objects.some((o) => o.id === id) ? id : null;
    } else {
      const id = st.addObject('wall', [this.ghostPos.x, this.ghostPos.y, this.ghostPos.z], this.ghostRot, this.placeBuilding()?.b.id, [this.wallLen / WALL_SEGMENT, 1, 1]);
      // odcinek w tej samej linii co poprzedni z łańcucha to nadal jedna ścianka
      const kept = this.lastWallId ? st.mergeWalls([this.lastWallId, id], { undo: false }) : [];
      this.lastWallId = kept[0] ?? id;
    }
    if (keepPlacing) {
      this.wallStart = end;
      this.updateGhost();
    } else st.setPlacing(null);
  }

  /** Budynek w miejscu, na którego murze wyląduje elewacja w punkcie (x, z): aktywny ma pierwszeństwo. */
  private findFacadeFor(type: string, x: number, z: number, preferId?: string): { b: PalaceObject; hit: ReturnType<typeof facadeSnap> } | null {
    const p = this.lastPalace;
    if (!p || p.interior) return null;
    const order = p.objects.filter((o) => isInPlace(o)).sort((a, b) => (a.id === preferId ? -1 : b.id === preferId ? 1 : 0));
    let best: { b: PalaceObject; hit: NonNullable<ReturnType<typeof facadeSnap>>; d: number } | null = null;
    for (const b of order) {
      const hit = facadeSnap(b, type, x, z);
      if (!hit) continue;
      const d = Math.hypot(hit.x - x, hit.z - z) - (b.id === preferId ? 0.3 : 0);
      if (!best || d < best.d) best = { b, hit, d };
    }
    return best ? { b: best.b, hit: best.hit } : null;
  }

  /** Piętro, na którym stawiamy elewację: edytowane piętro aktywnego budynku, inaczej parter. */
  private facadeFloor(b: PalaceObject): number {
    const pb = this.placeBuilding();
    return pb?.b.id === b.id ? pb.floor : 0;
  }

  private facadeBlockReason = '';

  /** Podgląd okna, balkonu i tarasu: przyciąga się do lica muru budynku z wnętrzem w miejscu. */
  private updateFacadeGhost() {
    if (!this.ghost || !this.ghostRing) return;
    const gp = new THREE.Vector3();
    if (!this.groundPoint(gp)) return;
    const st = useStore.getState();
    const found = this.findFacadeFor(this.ghostType, gp.x, gp.z, this.placeBuilding()?.b.id);
    this.facadeBlockReason = '';
    if (found && found.hit) {
      const floor = this.facadeFloor(found.b);
      this.ghostPos.set(found.hit.x, buildingFloorY(found.b, floor), found.hit.z);
      this.ghostRot = found.hit.yaw;
      this.ghostAnchor = found.b.id;
      if (!facadeFloorOk(this.ghostType, floor)) {
        this.facadeBlockReason = this.ghostType === 'balcony' ? 'Balkon stawia się na piętrze — przełącz piętro budynku.' : 'Taras stawia się przy parterze — przełącz na parter.';
      } else if (!facadeSlotFree(found.b, st.palace().objects, found.hit, this.ghostType, floor)) {
        this.facadeBlockReason = 'Tu jest już inny element elewacji — wybierz inne miejsce na murze.';
      }
      this.ghostBlocked = !!this.facadeBlockReason;
    } else {
      const snap = st.palace().settings.grid ? 0.5 : 0.05;
      this.ghostPos.set(Math.round(gp.x / snap) * snap, this.editFloorY(), Math.round(gp.z / snap) * snap);
      this.ghostAnchor = undefined;
      this.ghostBlocked = true;
      this.facadeBlockReason = 'Okna, balkony i tarasy stawia się na murze budynku z wnętrzem w miejscu.';
    }
    this.setGhostOpacity(this.ghostBlocked ? 0.3 : 0.6);
    this.ghost.position.copy(this.ghostPos);
    this.ghost.rotation.y = this.ghostRot;
    this.ghostRing.position.set(this.ghostPos.x, this.ghostPos.y + 0.03, this.ghostPos.z);
    (this.ghostRing.material as THREE.MeshBasicMaterial).color.set(this.ghostBlocked ? '#b4483d' : '#2b6ea8');
  }

  /** Podgląd drzwi: przyciąga się do osi najbliższej ścianki działowej; bez ścianki miejsce jest zablokowane. */
  private updateDoorGhost() {
    if (!this.ghost || !this.ghostRing) return;
    const gp = new THREE.Vector3();
    if (!this.groundPoint(gp)) return;
    const st = useStore.getState();
    const floorY = this.editFloorY();
    const hit = this.findWallFor(gp.x, gp.z);
    if (hit) {
      this.ghostPos.set(hit.x, hit.wall.position[1], hit.z);
      this.ghostRot = hit.wall.rotation[1] + (this.doorFlip ? Math.PI : 0);
      this.ghostAnchor = hit.wall.id;
      this.ghostBlocked = !doorSlotFree(hit.wall, st.palace().objects, hit.t);
    } else {
      const snap = st.palace().settings.grid ? 0.5 : 0.05;
      this.ghostPos.set(Math.round(gp.x / snap) * snap, floorY, Math.round(gp.z / snap) * snap);
      // z daleka duch obraca się już jak najbliższa ścianka, żeby było widać, jak drzwi w niej staną
      const near = this.findWallFor(gp.x, gp.z, undefined, 3);
      if (near) this.ghostRot = near.wall.rotation[1] + (this.doorFlip ? Math.PI : 0);
      this.ghostAnchor = undefined;
      this.ghostBlocked = true;
    }
    this.setGhostOpacity(hit ? 0.6 : 0.3);
    this.ghost.position.copy(this.ghostPos);
    this.ghost.rotation.y = this.ghostRot;
    this.ghostRing.position.set(this.ghostPos.x, this.ghostPos.y + 0.03, this.ghostPos.z);
    (this.ghostRing.material as THREE.MeshBasicMaterial).color.set(this.ghostBlocked ? '#b4483d' : '#2b6ea8');
  }

  /** Obrót podglądu o 15° (przycisk na dotyku; drzwi zmieniają stronę zawiasów). */
  rotateGhost() {
    if (!this.ghost) return;
    if (this.ghostType === 'door') this.doorFlip = !this.doorFlip;
    else {
      this.ghostRot += Math.PI / 12;
      this.ghostAutoRot = false;
    }
    this.updateGhost();
  }

  /** Krycie podglądu: bledszy, gdy jeszcze nie ma miejsca (drzwi poza ścianką). */
  private setGhostOpacity(opacity: number) {
    this.ghost?.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && m.userData.ghostMat) (m.material as THREE.Material).opacity = opacity;
    });
  }

  /** Ustawia ducha pod kursorem i sprawdza, czy miejsce jest wolne. */
  private updateGhost() {
    if (!this.ghost || !this.ghostRing) return;
    if (this.drawing()) return this.updateWallGhost();
    if (this.ghostType === 'door') return this.updateDoorGhost();
    if (isFacade(this.ghostType)) return this.updateFacadeGhost();
    const found = this.placementPoint(new Set());
    if (!found) return;
    const p = found.pos.clone();
    this.ghostAnchor = found.anchorId;
    const st = useStore.getState();
    const snap = st.palace().settings.grid ? 0.5 : 0.05;
    // na obiekcie stawiamy dokładnie tam, gdzie wskazuje kursor — bez przyciągania do siatki
    const floorY = this.editFloorY();
    if (found.onFloor) {
      // podłoga budynku: siatka jak na płycie, wysokość z trafienia
      p.x = Math.round(p.x / snap) * snap;
      p.z = Math.round(p.z / snap) * snap;
    } else if (!found.anchorId) {
      const onPlate = !this.walkArea || insideGround(this.walkArea, p.x, p.z);
      if (onPlate) {
        p.x = Math.round(p.x / snap) * snap;
        p.z = Math.round(p.z / snap) * snap;
        p.y = floorY;
      }
      // poza płytą zostaje wysokość terenu z punktu trafienia
    }
    if (this.ghostType === 'window' && this.room) this.snapWindowToWall(p);
    if (this.ghostSet?.back && this.ghostAutoRot) this.snapSetToWall(p);
    this.placeBlockReason = this.blockReasonAt(p) ?? '';
    this.ghostPos.copy(p);
    this.ghost.position.copy(p);
    this.ghost.rotation.y = this.ghostRot;
    this.ghostRing.position.set(p.x, p.y + 0.03, p.z);
    // na obiekcie okrąg jest niebieski (kotwiczenie), na ziemi zielony, a czerwony przy nachodzeniu
    const fp = this.ghostFootprint;
    let blocked = false;
    if (!this.ghostAnchor) {
      for (const e of this.entries.values()) {
        if (Math.hypot(e.group.position.x - p.x, e.group.position.z - p.z) < fp * 0.6 + e.footprint * hs(e) * 0.6) {
          blocked = true;
          break;
        }
      }
    }
    if (this.placeBlockReason) blocked = true;
    (this.ghostRing.material as THREE.MeshBasicMaterial).color.set(blocked ? '#b4483d' : this.ghostAnchor ? '#2b6ea8' : '#3f7550');
  }

  /**
   * Powód, dla którego podglądu nie wolno tu postawić. Zestaw sprawdzamy element po elemencie w miejscu,
   * w którym wylądują — inaczej obraz z zestawu trafiłby na okno.
   */
  private blockReasonAt(p: THREE.Vector3): string | null {
    const st = useStore.getState();
    const windows = this.ghostRoom()?.windows;
    if (this.ghostSet) {
      const cos = Math.cos(this.ghostRot);
      const sin = Math.sin(this.ghostRot);
      const byIndex = new Map(this.ghostSet.objects.map((o, i) => [i, o.type]));
      for (const so of this.ghostSet.objects) {
        const anchorType = so.anchor !== undefined ? byIndex.get(so.anchor) : undefined;
        const why = placementBlock(so.type, { anchorType, windows, x: p.x + so.dx * cos + so.dz * sin, z: p.z - so.dx * sin + so.dz * cos });
        if (why) return why;
      }
      return null;
    }
    const anchorType = this.ghostAnchor ? st.palace().objects.find((o) => o.id === this.ghostAnchor)?.type : undefined;
    return placementBlock(this.ghostType, { anchorType, windows, x: p.x, z: p.z });
  }

  /** Pokój, w którym stoi obiekt: wnętrze budynku, w którym jest zakotwiczony, albo pokój ładowany. */
  private roomForObject(o: PalaceObject): RoomShape | null {
    const p = this.lastPalace;
    if (!p) return null;
    if (p.interior) return roomOfSpec(roomSpecFor(p, useStore.getState().data.palaces), p.interior.buildingType);
    const b = buildingOf(p.objects, o);
    return b ? roomOfBuilding(b, p.objects) : null;
  }

  /** Pokój, w którym stoi podgląd: wnętrze w miejscu spod kursora albo pokój ładowany. */
  private ghostRoom(): RoomShape | null {
    const p = this.lastPalace;
    if (!p) return null;
    if (p.interior) return roomOfSpec(roomSpecFor(p, useStore.getState().data.palaces), p.interior.buildingType);
    const b = this.placeBuilding()?.b;
    return b ? roomOfBuilding(b, p.objects) : null;
  }

  /**
   * Zestaw z tyłem sam staje plecami do najbliższej ściany (mur pokoju albo ścianka działowa) w promieniu
   * 1,6 m — inaczej obrazy i lustra z zestawu wisiałyby w powietrzu. Ręczny obrót wyłącza to na stałe.
   */
  private snapSetToWall(p: THREE.Vector3) {
    const set = this.ghostSet;
    if (!set) return;
    const room = this.ghostRoom();
    const half = set.depth / 2 + SET_WALL_GAP;
    let best: { yaw: number; x: number; z: number; dist: number } | null = null;
    // kursor za licem muru liczy się jak zero — inaczej celowanie w ścianę od zewnątrz nie przyciągałoby
    const take = (yaw: number, x: number, z: number, raw: number) => {
      const dist = Math.max(0, raw);
      if (dist < 1.6 && (!best || dist < best.dist)) best = { yaw, x, z, dist };
    };
    // lokalne +Z zestawu (jego przód) pada w świecie na kierunek (sin yaw, cos yaw); tył ma dotykać ściany
    if (room && room.radius === undefined && insideRoom(room, p.x, p.z, -0.9)) {
      const [lx, lz] = boxLocal(room.box, p.x, p.z);
      const inX = room.box.hx - half;
      const inZ = room.box.hz - half;
      const sides: [number, number, number][] = [
        [room.box.hz + lz, 0, -inZ], // mur przy −Z: zestaw stoi przed nim i patrzy w +Z
        [room.box.hz - lz, Math.PI, inZ],
        [room.box.hx + lx, Math.PI / 2, -inX],
        [room.box.hx - lx, -Math.PI / 2, inX],
      ];
      for (const [dist, yaw, edge] of sides) {
        const alongX = Math.abs(Math.cos(yaw)) < 0.5;
        const [wx, wz] = alongX ? boxPoint(room.box, edge, lz) : boxPoint(room.box, lx, edge);
        take(room.box.yaw + yaw, wx, wz, dist);
      }
    }
    const st = useStore.getState();
    const floorY = this.editFloorY();
    for (const w of st.palace().objects) {
      if (w.type !== 'wall' || Math.abs(w.position[1] - floorY) > 0.5) continue;
      const { t, dist } = wallOffsetOf(w, p.x, p.z);
      if (Math.abs(t) > wallLength(w) / 2) continue;
      // normalna ścianki to (sin r, cos r); zestaw zostaje po tej stronie, po której jest kursor
      const r = w.rotation[1];
      const side = Math.sign((p.x - w.position[0]) * Math.sin(r) + (p.z - w.position[2]) * Math.cos(r)) || 1;
      const yaw = side > 0 ? r : r + Math.PI;
      const base = wallPointAt(w, t);
      take(yaw, base[0] + Math.sin(yaw) * half, base[1] + Math.cos(yaw) * half, dist);
    }
    if (!best) {
      this.ghostRot = 0; // z dala od ścian wracamy do ustawienia wyjściowego, inaczej obrót zostałby po chwilowym przyciągnięciu
      return;
    }
    // domknięcie `take` gubi zawężenie typu, stąd rzutowanie
    const hit = best as { yaw: number; x: number; z: number; dist: number };
    this.ghostRot = hit.yaw;
    p.x = hit.x;
    p.z = hit.z;
  }

  /** Okno zawsze stoi w najbliższej ścianie obwodowej edytowanego piętra, twarzą do środka pokoju. */
  private snapWindowToWall(p: THREE.Vector3) {
    const editFloor = useStore.getState().editFloor;
    const walls = (this.room?.walls ?? []).filter((wm) => wm.userData.floorIndex === editFloor);
    let best: { normal: [number, number]; pos: THREE.Vector3 } | null = null;
    let bestDist = Infinity;
    for (const wmesh of walls) {
      const n = wmesh.userData.wallNormal as [number, number] | undefined;
      if (!n) continue;
      const d = Math.abs((p.x - wmesh.position.x) * n[0] + (p.z - wmesh.position.z) * n[1]);
      if (d < bestDist) {
        bestDist = d;
        best = { normal: n, pos: wmesh.position };
      }
    }
    if (!best) return;
    const [nx, nz] = best.normal;
    if (Math.abs(nx) > Math.abs(nz)) {
      p.x = best.pos.x - nx * 0.06;
      this.ghostRot = Math.PI / 2;
    } else {
      p.z = best.pos.z - nz * 0.06;
      this.ghostRot = 0;
    }
    p.y = editFloor * floorHeightFor(this.lastPalace);
  }

  /** Stawia obiekt w miejscu podglądu. */
  private commitPlacement(keepPlacing: boolean) {
    const st = useStore.getState();
    const type = this.ghostType;
    if (!type) return;
    if (isDrawn(type) && !this.ghostIds) return this.commitWall(keepPlacing);
    if (type === 'door' && (this.ghostBlocked || !this.ghostAnchor)) {
      st.showToast(this.ghostAnchor ? 'Tu są już inne drzwi — wybierz inne miejsce w ściance.' : 'Drzwi stawia się w ściance działowej.');
      return;
    }
    if (isFacade(type) && (this.ghostBlocked || !this.ghostAnchor)) {
      st.showToast(this.facadeBlockReason || 'Okna, balkony i tarasy stawia się na murze budynku z wnętrzem w miejscu.');
      return;
    }
    if (this.placeBlockReason) {
      st.showToast(this.placeBlockReason);
      return;
    }
    if (this.ghostSet) {
      st.placeSet(this.ghostSet.id, { position: [this.ghostPos.x, this.ghostPos.y, this.ghostPos.z], rotation: this.ghostRot, anchorId: this.ghostAnchor });
      if (!keepPlacing) st.setPlacing(null);
      return;
    }
    if (this.ghostIds) {
      // kopie oryginałów z ich konfiguracją, w miejscu i obrocie podglądu
      st.duplicateObjectsAt(this.ghostIds, { position: [this.ghostPos.x, this.ghostPos.y, this.ghostPos.z], rotation: this.ghostRot, anchorId: this.ghostAnchor, absolute: type === 'door' });
      if (!keepPlacing) st.setPlacing(null);
      return;
    }
    st.addObject(type, [this.ghostPos.x, this.ghostPos.y, this.ghostPos.z], this.ghostRot, this.ghostAnchor);
    if (!keepPlacing) st.setPlacing(null);
  }

  /** Po ręcznym przesunięciu w pionie sprawdza, czy obiekt stoi na czymś. */
  private snapAnchorUnder() {
    const obj = this.gizmo.object as THREE.Group | undefined;
    const id = obj?.userData.objectId as string | undefined;
    if (!id) return;
    const st = useStore.getState();
    const o = st.palace().objects.find((x) => x.id === id);
    if (!o || o.type === 'door' || isFacade(o.type)) return; // kotwicą drzwi jest ścianka, elewacji mur — nie to, na czym stoją
    const exclude = new Set<string>([id, ...descendants(st.palace().objects, id).map((x) => x.id)]);
    const from = new THREE.Vector3(obj!.position.x, obj!.position.y + 0.2, obj!.position.z);
    const ray = new THREE.Raycaster(from, new THREE.Vector3(0, -1, 0), 0, 3);
    const targets: THREE.Object3D[] = [];
    for (const [eid, e] of this.entries) if (!exclude.has(eid) && colliderKind(e.type) !== 'none') targets.push(e.group);
    const hit = ray.intersectObjects(targets, true).find((h) => !h.object.userData.noPick && h.object.userData.objectId);
    const anchorId = hit && Math.abs(hit.point.y - obj!.position.y) < 0.2 ? (hit.object.userData.objectId as string) : undefined;
    const room = this.roomForObject(o);
    const why = placementBlock(o.type, { anchorType: anchorId ? st.palace().objects.find((x) => x.id === anchorId)?.type : undefined, windows: room?.windows, x: o.position[0], z: o.position[2] });
    // cofamy tylko ruch, który naprawdę się odbył: samo kliknięcie uchwytu na obiekcie stojącym już źle
    // (np. z importu) nie może cofać cudzej zmiany
    const moved = !this.dragFrom || this.dragFrom.distanceToSquared(obj!.position) > 1e-6;
    if (why && moved) {
      // przeciągnięcie zaczęło się od wpisu cofania, więc obiekt wraca dokładnie tam, gdzie stał;
      // upuszczenie na podłogę nie pomogłoby przy obrazie, bo ten dalej byłby nad oknem
      st.showToast(why);
      st.undo();
      return;
    }
    if (anchorId !== o.anchorId) st.updateObject(id, { anchorId }, { undo: false });
  }

  /** Dopina albo odpina uchwyt zależnie od trybu, narzędzia i zaznaczenia; przy kilku obiektach celem jest pivot. */
  private syncGizmo() {
    if (this.gizmoDragging) return;
    const st = useStore.getState();
    const ids = st.selectedIds;
    const roots = this.lastPalace ? selectionRoots(this.lastPalace.objects, ids).filter((o) => this.entries.has(o.id)) : [];
    const single = roots.length === 1 ? this.entries.get(roots[0].id) : undefined;
    const multi = roots.length > 1;
    const wanted = this.mode === 'editor' && (!!single || multi) && !st.review && !st.placing && st.tool !== 'select';
    if (!wanted) {
      for (const g of [this.gizmo, this.rotateGizmo]) {
        if (g.object) g.detach();
        g.enabled = false;
        g.getHelper().visible = false;
      }
      return;
    }
    let target: THREE.Object3D;
    if (multi) {
      let minY = Infinity;
      const c = new THREE.Vector3();
      for (const o of roots) {
        c.x += o.position[0];
        c.z += o.position[2];
        minY = Math.min(minY, o.position[1]);
      }
      this.pivot.position.set(c.x / roots.length, minY, c.z / roots.length);
      this.pivot.rotation.set(0, 0, 0);
      target = this.pivot;
    } else target = single!.group;
    // obrót drzwi wynika ze ścianki, więc uchwyt obrotu dla nich milczy
    const noRotate = !multi && (single!.type === 'door' || isFacade(single!.type));
    for (const g of [this.gizmo, this.rotateGizmo]) {
      if (g === this.rotateGizmo && noRotate) {
        if (g.object) g.detach();
        g.enabled = false;
        g.getHelper().visible = false;
        continue;
      }
      g.enabled = true;
      g.getHelper().visible = true;
      if (g.object !== target) g.attach(target);
    }
    // tylko poziomy pierścień: pierścienie X/Z, pierścień ekranowy i kula swobodnego obrotu łapały
    // kliknięcia daleko od widocznej linii i przechylały obiekt; przechył zostaje w panelu
    this.rotateGizmo.showX = false;
    this.rotateGizmo.showZ = false;
    this.rotateGizmo.showY = true;
    this.gizmo.translationSnap = this.lastPalace?.settings.grid ? 0.5 : null;
  }

  private setMode(mode: ViewMode) {
    const prevMode = this.mode;
    if (mode === 'editor') {
      this.abortDescent();
      if (this.ride) this.riding ? this.leaveMount(true) : this.parkMount();
    }
    if (mode !== 'editor' && this.topView) this.leaveTopView(true);
    if (mode === 'vr') {
      this.mode = 'vr';
      if (this.room) this.room.ceiling.visible = true;
      this.ensurePhysics();
      this.orbit.enabled = false;
      this.labelRenderer.domElement.style.display = 'none';
      // punkt startu wyznaczamy tylko wtedy, gdy gracz dopiero wchodzi do świata; przełączenie
      // spaceru na VR i z powrotem ma zostawić go tam, gdzie stał — inaczej zwiedzanie zaczyna się od nowa
      if (prevMode === 'editor') this.editorToFp();
      this.enterVR().catch((err) => {
        console.error(err);
        useStore.getState().showToast('Nie udało się uruchomić VR: ' + (err as Error).message);
        useStore.getState().setViewMode('fp');
      });
      this.applyFloorVisibility();
      this.refreshLabels(this.lastPalace!);
      this.refreshPanels(this.lastPalace!);
      this.applySelection(useStore.getState().selectedIds, null);
      return;
    }
    if (prevMode === 'vr') this.exitVR();
    if (mode !== 'fp') this.dropBow();
    if (mode === 'fp') {
      if (prevMode === 'editor') this.editorToFp();
      this.ensurePhysics();
      this.orbit.enabled = false;
      this.labelRenderer.domElement.style.display = 'none';
    } else {
      if (prevMode !== 'editor') this.fpToEditor();
      this.orbit.enabled = true;
      this.labelRenderer.domElement.style.display = '';
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.mode = mode;
    if (mode === 'editor') {
      useStore.getState().setInsideBuilding(null);
      this.updateGroundPlane();
    }
    this.syncGizmo();
    this.syncWildlife();
    this.applyFloorVisibility();
    if (this.room) this.room.ceiling.visible = mode !== 'editor';
    this.refreshLabels(this.lastPalace!);
    this.refreshPanels(this.lastPalace!);
    this.applySelection(useStore.getState().selectedIds, null);
  }

  /**
   * Miejsce, w którym zaczyna się spacer: wnętrze → przy drzwiach pokoju,
   * plansza → przy bramie wejściowej, a gdy jej nie ma → środek południowej krawędzi.
   */
  private spawnPose(): { x: number; z: number; yaw: number } {
    const p = this.lastPalace;
    if (p?.interior && this.room) {
      return { x: this.room.spawn.pos.x, z: this.room.spawn.pos.z, yaw: this.room.spawn.yaw };
    }
    const gate = p?.objects.find((o) => o.type === 'gate');
    const e = gate ? this.entries.get(gate.id) : undefined;
    if (gate && e) {
      const w = e.group.localToWorld(tmpV.set(GATE_SPAWN[0], GATE_SPAWN[1], GATE_SPAWN[2]));
      return { x: this.clampX(w.x), z: this.clampZ(w.z), yaw: yawOfObject(gate) };
    }
    const [ex, ez] = this.walkArea ? clampToGround(this.walkArea, 0, 1e4, 0.8) : [0, this.bounds.hz - 0.8];
    return { x: ex, z: ez, yaw: 0 };
  }

  /** Stawia gracza w zadanym miejscu i ustawia kamerę pierwszej osoby. */
  private placeRig(pose: { x: number; z: number; yaw: number }) {
    this.rig.position.set(pose.x, 0, pose.z);
    this.yaw = pose.yaw;
    this.pitch = -0.05;
    this.rig.rotation.set(0, this.yaw, 0);
    if (!this.renderer.xr.isPresenting) {
      // W goglach pozycję głowy podaje headset. W trybie stereo czujniki dają sam obrót, więc wysokość
      // oczu trzeba ustawić samemu — bez tego po wysiadce z samolotu (kamera zjeżdża wtedy do zera,
      // bo w kokpicie siedzi w środku riga) głowa zostaje na poziomie stóp i widać świat od spodu.
      this.camera.position.set(0, EYE, 0);
      if (!this.stereo) {
        this.camera.rotation.set(this.pitch, 0, 0);
        this.camera.fov = 70;
        this.camera.updateProjectionMatrix();
      }
    }
    this.tween = null;
    // kapsuła fizyki musi trafić w to samo miejsce, inaczej gracz wróciłby do starej pozycji
    this.physics?.teleport(tmpV3.set(pose.x, 0, pose.z));
  }

  /**
   * Spacer zaczyna się tam, gdzie patrzył edytor: pod celem orbity, twarzą w kierunku spojrzenia kamery.
   * Dzięki temu przełączanie trybów nie przenosi gracza z powrotem do bramy; punkt startu (spawnPose)
   * służy tylko poleceniom kamery „wyśrodkuj”/„resetuj” i wysiadce z samolotu.
   */
  private editorToFp() {
    const target = this.tween?.toTarget ?? this.orbit.target;
    const dx = target.x - this.camera.position.x;
    const dz = target.z - this.camera.position.z;
    const len = Math.hypot(dx, dz);
    // rig patrzy wzdłuż (0,0,-1) obróconego o yaw, więc kierunek (dx,dz) daje yaw = atan2(-dx, -dz)
    const yaw = len > 1e-3 ? Math.atan2(-dx, -dz) : this.yaw;
    // fpToEditor stawia cel orbity EDITOR_LOOK_AHEAD przed graczem, więc cofamy się o tyle samo:
    // dzięki temu wielokrotne przełączanie trybów nie przesuwa gracza do przodu
    const back = len > 1e-3 ? EDITOR_LOOK_AHEAD / len : 0;
    const [x, z] = this.clampXZ(target.x - dx * back, target.z - dz * back);
    this.placeRig({ x, z, yaw });
  }

  private fpToEditor() {
    const fwd = tmpV.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const target = this.rig.position.clone().add(fwd.multiplyScalar(EDITOR_LOOK_AHEAD)).setY(0.5);
    const camPos = target.clone().add(new THREE.Vector3(-fwd.x, 0, -fwd.z).normalize().multiplyScalar(11)).setY(9);
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.camera.position.copy(camPos);
    this.camera.rotation.set(0, 0, 0);
    this.camera.fov = 38;
    this.camera.updateProjectionMatrix();
    this.orbit.target.copy(target);
    this.orbit.update();
  }

  /** Najbliższy punkt na planszy (we wnętrzu prostokąt pokoju, na zewnątrz obrys płyty). */
  private clampXZ(x: number, z: number): [number, number] {
    const g = this.walkArea;
    if (!g) return [THREE.MathUtils.clamp(x, -this.bounds.hx, this.bounds.hx), THREE.MathUtils.clamp(z, -this.bounds.hz, this.bounds.hz)];
    return clampToGround(g, x, z, 0.4);
  }
  /**
   * Granica chodzenia. Po płycie zawsze, a gdy pałac ma krajobraz — także po nim, aż do krawędzi terenu:
   * teren ma własną bryłę kolizji, więc da się zejść z planszy na wzgórza i wrócić. Bez krajobrazu
   * (`scenery: 'none'`) poza płytą nie ma po czym chodzić, więc zostaje przycięcie do planszy.
   */
  private clampWalk(x: number, z: number): [number, number] {
    if (!this.terrain) return this.clampXZ(x, z);
    const r = this.rideRadius();
    const d = Math.hypot(x, z);
    return d <= r ? [x, z] : [(x / d) * r, (z / d) * r];
  }

  private clampX(x: number) {
    return this.clampXZ(x, 0)[0];
  }
  private clampZ(z: number) {
    return this.clampXZ(0, z)[1];
  }

  // ---------- VR ----------
  private async enterVR() {
    const st = useStore.getState();
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    let supported = false;
    if (xr) {
      try {
        supported = await xr.isSessionSupported('immersive-vr');
      } catch {
        supported = false;
      }
    }
    if (xr && supported) {
      const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      this.xrSession = session;
      let floor = true;
      try {
        await session.requestReferenceSpace('local-floor');
      } catch {
        floor = false;
      }
      this.xrFloor = floor;
      this.renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      this.headOffset = floor ? 0 : EYE;
      session.addEventListener('end', () => {
        this.xrSession = null;
        this.headOffset = 0;
        this.rig.position.y = 0;
        this.camera.position.set(0, EYE, 0);
        if (useStore.getState().viewMode === 'vr') useStore.getState().setViewMode('fp');
        useStore.getState().setVrActive(false);
      });
      // w goglach głowę śledzi headset i kamera nie usiadłaby na fotelu — lot kończymy przed wejściem
      this.leaveMount(true);
      await this.renderer.xr.setSession(session);
      st.setVrActive(true);
      st.showToast('Podejdź do obiektu i naciśnij, aby odsłonić notatkę.');
      return;
    }
    // Fallback: stereo + czujniki telefonu
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') throw new Error('brak zgody na czujniki');
      } catch (e) {
        throw new Error('Brak dostępu do czujników ruchu (' + (e as Error).message + ')');
      }
    }
    window.addEventListener('deviceorientation', this.onOrientation, true);
    this.deviceOrient.active = false;
    this.stereo = new StereoEffect(this.renderer);
    this.stereo.setEyeSeparation(0.064);
    this.resize();
    try {
      // pełny ekran zwykle włącza już przycisk VR (musi paść w geście dotknięcia);
      // tu jest druga próba dla przeglądarek, które na to pozwalają także później
      if (!document.fullscreenElement) {
        const fsTarget = (this.container.closest('.viewport') as HTMLElement | null) ?? this.container;
        await fsTarget.requestFullscreen?.();
      }
      // blokada orientacji działa dopiero przy włączonym pełnym ekranie
      if (document.fullscreenElement) {
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
      }
      // na telefonie bez pełnego ekranu chowamy pasek adresu przewinięciem
      window.scrollTo(0, 1);
    } catch {
      /* ignoruj */
    }
    st.setVrActive(true);
  }

  private exitVR() {
    if (this.xrSession) {
      this.xrSession.end().catch(() => undefined);
      this.xrSession = null;
    }
    if (this.stereo) {
      this.stereo = null;
      window.removeEventListener('deviceorientation', this.onOrientation, true);
      this.camera.rotation.set(this.pitch, 0, 0);
      // w kokpicie kamera siedzi w środku riga; poza nim musi wrócić na wysokość oczu
      if (!this.riding) this.camera.position.set(0, EYE, 0);
      this.rig.rotation.set(0, this.yaw, 0);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      try {
        (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
      } catch {
        /* ignoruj */
      }
      this.resize();
    }
    useStore.getState().setVrActive(false);
  }

  /** Naciśnięcie spustu w goglach: to samo co kliknięcie w trybie z oczu. */
  private onVrSelect(controller?: THREE.Object3D) {
    if (this.useDoor()) return;
    let id: string | null = null;
    if (controller) {
      // promień biegnie wzdłuż osi kontrolera
      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      this.raycaster.ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
      id = this.pickRay();
    } else {
      id = this.pick(new THREE.Vector2(0, 0));
    }
    this.fpInteract(id);
  }

  // ---------- kamera ----------
  private flyTo(objectId: string) {
    // w goglach nie przenosimy gracza — sam podchodzi do kolejnego przystanku
    if (this.mode === 'vr') return;
    const o = this.lastPalace?.objects.find((x) => x.id === objectId);
    const e = this.entries.get(objectId);
    if (!o || !e) return;
    const objPos = new THREE.Vector3(o.position[0], 0, o.position[2]);
    if (this.mode === 'editor') {
      const target = objPos.clone().setY(Math.min(e.height * o.scale[1] * 0.45, 2));
      const offset = this.camera.position.clone().sub(this.orbit.target);
      const dist = THREE.MathUtils.clamp(offset.length(), 9, 14);
      offset.normalize().multiplyScalar(dist);
      if (offset.y < 4) offset.y = 4;
      this.tween = { t: 0, dur: 0.9, fromPos: this.camera.position.clone(), toPos: target.clone().add(offset), fromTarget: this.orbit.target.clone(), toTarget: target };
      return;
    }
    // widok z oczu / VR: stań przed obiektem, twarzą do niego
    const from = this.rig.position.clone().setY(0);
    let dir = from.sub(objPos);
    if (dir.length() < 0.3) dir = new THREE.Vector3(0, 0, 1);
    dir.setY(0).normalize();
    const dist = (e.footprint + 1.2) * hs(e) + 1.2;
    const pos = objPos.clone().add(dir.multiplyScalar(dist));
    const [rx, rz] = this.resolveCollisions(pos.x, pos.z, objectId, 0.9);
    const [fx, fz] = this.clampXZ(rx, rz);
    pos.x = fx;
    pos.z = fz;
    const look = objPos.clone().sub(pos);
    const desiredYaw = Math.atan2(-look.x, -look.z);
    // obiekt może stać na innym piętrze — gracz musi wylądować na tej samej podłodze, nie tylko obok w XZ
    const building = this.lastPalace ? buildingOf(this.lastPalace.objects, o) : undefined;
    const footY = building ? buildingFloorY(building, floorOfIn(building, o.position[1])) : this.lastPalace?.interior ? floorOf(o.position[1], floorHeightFor(this.lastPalace)) * floorHeightFor(this.lastPalace) : 0;
    this.rig.position.x = pos.x;
    this.rig.position.z = pos.z;
    this.rig.position.y = footY + this.headOffset;
    this.physics?.teleport(new THREE.Vector3(pos.x, footY, pos.z));
    if (this.renderer.xr.isPresenting || this.stereo) {
      // kompensacja obrotu głowy
      const headQ = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera().getWorldQuaternion(tmpQ) : this.camera.getWorldQuaternion(tmpQ);
      const headYaw = yawOf(headQ) - this.rig.rotation.y;
      this.rig.rotation.y = desiredYaw - headYaw;
      this.yaw = this.rig.rotation.y;
    } else {
      this.yaw = desiredYaw;
      this.pitch = -0.08;
      this.rig.rotation.y = this.yaw;
      this.camera.rotation.set(this.pitch, 0, 0);
    }
  }

  /** Wysokość kamery w rzucie z góry, tak by cała plansza mieściła się w kadrze. */
  private topViewHeight(): number {
    const size = this.lastPalace ? groundExtent(this.lastPalace.settings.ground) : 24;
    const half = size / 2 + 2;
    const halfFov = THREE.MathUtils.degToRad(TOP_VIEW_FOV / 2);
    return half / Math.tan(halfFov) / Math.min(1, this.camera.aspect);
  }

  private enterTopView() {
    if (this.topView) return;
    this.savedCam = { pos: this.camera.position.clone(), target: this.orbit.target.clone(), fov: this.camera.fov };
    this.topView = true;
    this.orbit.enableRotate = false;
    this.orbit.enableDamping = false;
    this.orbit.screenSpacePanning = true;
    this.orbit.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.orbit.touches.ONE = THREE.TOUCH.PAN; // rzut z góry na dotyku: palec przesuwa planszę
    this.orbit.maxDistance = 400;
    this.camera.fov = TOP_VIEW_FOV;
    this.camera.updateProjectionMatrix();
    useStore.getState().setTopView(true);
    this.weather.setCloudsVisible(false);
    this.tween = {
      t: 0,
      dur: 0.7,
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(0, this.topViewHeight(), 0.001),
      fromTarget: this.orbit.target.clone(),
      toTarget: new THREE.Vector3(0, 0, 0),
      // blokada kąta dopiero po dolocie, inaczej kamera skoczyłaby w pion natychmiast
      onDone: () => {
        // gracz mógł w trakcie dolotu przytrzymać środkowy przycisk — wtedy blokady nie zakładamy
        if (!this.topView || this.freeLook) return;
        this.orbit.minPolarAngle = 0;
        this.orbit.maxPolarAngle = 0;
      },
    };
  }

  /** Koniec chwilowego obrotu w rzucie z góry: kamera płynnie wraca nad planszę i kąt znów jest zablokowany. */
  private endFreeLook() {
    if (!this.freeLook) return;
    this.freeLook = false;
    // bez tłumienia update() zużywa resztę prędkości od razu, więc tween startuje z miejsca, w którym stanęła kamera
    this.orbit.enableDamping = false;
    this.orbit.update();
    this.orbit.enableRotate = false;
    if (!this.topView) return;
    const target = this.orbit.target.clone();
    const dist = this.camera.position.distanceTo(target);
    this.tween = {
      t: 0,
      dur: 0.45,
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(target.x, target.y + dist, target.z + 0.001),
      fromTarget: target.clone(),
      toTarget: target,
      onDone: () => {
        if (!this.topView || this.freeLook) return;
        this.orbit.minPolarAngle = 0;
        this.orbit.maxPolarAngle = 0;
      },
    };
  }

  private onWindowBlur = () => {
    this.keys.clear();
    this.touchLook.clear(); // przy utracie okna nie przyjdzie już `pointerup` tych palców
    this.archery?.setPulling(false); // ani `pointerup` puszczonej cięciwy
    this.endFreeLook();
  };

  private leaveTopView(instant = false) {
    if (!this.topView) return;
    this.topView = false;
    this.freeLook = false;
    this.orbit.maxPolarAngle = 1.45;
    this.orbit.minPolarAngle = 0;
    this.orbit.enableRotate = true;
    this.orbit.enableDamping = true;
    this.orbit.enabled = !this.gizmoDragging;
    this.orbit.screenSpacePanning = false;
    this.orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.orbit.touches.ONE = THREE.TOUCH.ROTATE;
    this.orbit.maxDistance = 70;
    this.camera.fov = 38;
    this.camera.updateProjectionMatrix();
    useStore.getState().setTopView(false);
    this.weather.setCloudsVisible(true);
    const saved = this.savedCam;
    this.savedCam = null;
    if (!saved) return;
    if (instant) {
      this.camera.position.copy(saved.pos);
      this.orbit.target.copy(saved.target);
      this.orbit.update();
      this.tween = null;
      return;
    }
    this.tween = { t: 0, dur: 0.6, fromPos: this.camera.position.clone(), toPos: saved.pos, fromTarget: this.orbit.target.clone(), toTarget: saved.target };
  }

  private cameraCommand(kind: CameraKind, instant = false) {
    if (this.mode !== 'editor') {
      if (this.mode === 'vr') return; // w goglach nie przestawiamy gracza samoczynnie
      if (kind === 'fit' || kind === 'reset' || kind === 'center') this.placeRig(this.spawnPose());
      return;
    }
    if (kind === 'topView') {
      if (this.topView) this.leaveTopView();
      else this.enterTopView();
      return;
    }
    if (this.topView) {
      // każde inne polecenie kamery wychodzi z rzutu z góry
      this.leaveTopView(true);
    }
    if (kind === 'zoomIn' || kind === 'zoomOut') {
      const off = this.camera.position.clone().sub(this.orbit.target);
      const f = kind === 'zoomIn' ? 0.78 : 1.28;
      const len = THREE.MathUtils.clamp(off.length() * f, this.orbit.minDistance, this.orbit.maxDistance);
      off.setLength(len);
      this.tween = { t: 0, dur: 0.35, fromPos: this.camera.position.clone(), toPos: this.orbit.target.clone().add(off), fromTarget: this.orbit.target.clone(), toTarget: this.orbit.target.clone() };
      return;
    }
    const p = this.lastPalace;
    let center = new THREE.Vector3(0, 0.5, 0);
    let radius = (p ? groundExtent(p.settings.ground) : 24) / 2;
    if (kind !== 'reset' && p && p.objects.length > 0) {
      const box = new THREE.Box3();
      for (const o of p.objects) box.expandByPoint(new THREE.Vector3(o.position[0], 0, o.position[2]));
      box.expandByScalar(2.5);
      box.getCenter(center);
      center.y = 0.5;
      radius = Math.max(box.getSize(tmpV).length() / 2, 6);
    }
    const isInteriorScene = !!p?.interior;
    // we wnętrzu kadrujemy cały pokój, nie tylko postawione w nim przedmioty, na wysokości edytowanego piętra
    if (isInteriorScene) {
      radius = Math.max(radius, (p ? groundExtent(p.settings.ground) : 12) * 0.78);
      center.y = useStore.getState().editFloor * floorHeightFor(p) + 0.5;
    }
    const active = kind === 'center' ? this.activeBuilding() : undefined;
    if (active) {
      const e = this.entries.get(active.id);
      center = new THREE.Vector3(active.position[0], buildingFloorY(active, useStore.getState().editFloor) + 0.5, active.position[2]);
      radius = Math.max(4, (e ? e.footprint * hs(e) : 3) * 1.6);
    }
    const dist = radius * 2.1;
    // 'center' i 'reset' wracają do domyślnego rzutu izometrycznego, 'fit' zachowuje bieżący kierunek
    const isInterior = !!p?.interior;
    const dir = kind === 'fit' ? this.camera.position.clone().sub(this.orbit.target).normalize() : new THREE.Vector3(1, isInterior ? 1.5 : 0.85, 1).normalize();
    if (dir.y < 0.4) dir.y = 0.6;
    dir.normalize();
    const toPos = center.clone().add(dir.multiplyScalar(dist));
    if (instant) {
      this.camera.position.copy(toPos);
      this.orbit.target.copy(center);
      this.orbit.update();
      return;
    }
    this.tween = { t: 0, dur: 0.7, fromPos: this.camera.position.clone(), toPos, fromTarget: this.orbit.target.clone(), toTarget: center };
  }

  // ---------- interakcja ----------
  private setPointer(ev: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(ndc?: THREE.Vector2): string | null {
    this.raycaster.setFromCamera(ndc ?? this.pointer, this.camera);
    return this.pickRay();
  }

  /** Wybór obiektu wzdłuż aktualnie ustawionego promienia. */
  private pickRay(): string | null {
    this.pickedExitDoor = false;
    const targets: THREE.Object3D[] = [...this.entries.values()].filter((e) => e.group.visible).map((e) => e.group);
    if (this.mode !== 'editor') targets.push(...this.wildlife.pickables());
    if (this.room) targets.push(this.room.exitDoor);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      if (!isShown(h.object)) continue;
      if (h.object.userData.exitDoor) {
        this.pickedExitDoor = true;
        return null;
      }
      const id = h.object.userData.objectId as string | undefined;
      if (id) {
        this.pickPoint.copy(h.point);
        return id;
      }
    }
    return null;
  }

  /**
   * Punkt, w którym stanie stawiany obiekt: wierzch obiektu pod kursorem (wtedy kotwiczymy)
   * albo płaszczyzna ziemi.
   */
  private placementPoint(excludeIds: Set<string>): { pos: THREE.Vector3; anchorId?: string; onFloor?: boolean } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const [id, e] of this.entries) {
      if (excludeIds.has(id) || colliderKind(e.type) === 'none') continue;
      targets.push(e.group);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      if (h.object.userData.noPick || !isShown(h.object)) continue;
      const id = h.object.userData.objectId as string | undefined;
      if (!id || excludeIds.has(id)) continue;
      const e = this.entries.get(id);
      if (!e) continue;
      // podłoga budynku: stawiamy w punkcie trafienia, nie na wierzchu całego modelu (dachu)
      if (h.object.userData.floorSurface) return { pos: h.point.clone(), anchorId: id, onFloor: true };
      // mur albo strop budynku, w którym stoimy: obiekt ląduje na bieżącym piętrze pod punktem trafienia,
      // a nie na szczycie bryły (dachu) — tak stawia się np. obraz przy ścianie w spacerze
      const pb = this.placeBuilding();
      if (e.inplace && pb?.b.id === id) return { pos: new THREE.Vector3(h.point.x, buildingFloorY(pb.b, pb.floor), h.point.z), anchorId: id, onFloor: true };
      const box = new THREE.Box3().setFromObject(e.model);
      return { pos: new THREE.Vector3(h.point.x, box.max.y, h.point.z), anchorId: id };
    }
    // płyta i teren wokół niej — obiekty można stawiać także poza obszarem chodzenia
    const surfaces: THREE.Object3D[] = [];
    if (this.ground.visible) surfaces.push(this.ground);
    if (this.terrain?.group.visible) surfaces.push(this.terrain.mesh);
    if (surfaces.length > 0) {
      const sh = this.raycaster.intersectObjects(surfaces, false);
      if (sh.length > 0) return { pos: sh[0].point.clone() };
    }
    const gp = new THREE.Vector3();
    if (!this.groundPoint(gp)) return null;
    return { pos: gp };
  }

  /** Dokłada kafel pod kursorem do bieżącego pociągnięcia i odświeża podgląd. */
  private brushAt() {
    if (!this.brushTiles) return;
    const p = new THREE.Vector3();
    if (!this.groundPoint(p)) return;
    const [i, j] = tileAt(p.x, p.z);
    if (this.brushLast && (this.brushLast[0] !== i || this.brushLast[1] !== j)) {
      // szybkie przeciągnięcie przeskakuje kilka kafli naraz; łączymy je łamaną po bokach (najpierw w osi X,
      // potem w Z), żeby ślad był ciągły, a kafle stykały się bokiem, nie rogiem
      const [i0, j0] = this.brushLast;
      const stepX = Math.sign(i - i0);
      const stepZ = Math.sign(j - j0);
      for (let x = i0; x !== i; x += stepX) this.addBrushTile(x, j0);
      for (let z = j0; z !== j; z += stepZ) this.addBrushTile(i, z);
    }
    this.brushLast = [i, j];
    this.addBrushTile(i, j);
  }

  private addBrushTile(i: number, j: number) {
    if (!this.brushTiles) return;
    const key = `${i},${j}`;
    if (this.brushTiles.has(key)) return;
    this.brushTiles.set(key, [i, j]);
    this.showBrushPreview();
  }

  /** Obrys malowanych kafli: zielony przy dokładaniu, czerwony przy wymazywaniu. */
  private showBrushPreview() {
    this.clearBrushPreview();
    if (!this.brushTiles || this.brushTiles.size === 0) return;
    const pts: number[] = [];
    for (const [i, j] of this.brushTiles.values()) {
      const x0 = i * GROUND_TILE;
      const x1 = x0 + GROUND_TILE;
      const z0 = j * GROUND_TILE;
      const z1 = z0 + GROUND_TILE;
      const ring: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      for (let k = 0; k < 4; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % 4];
        pts.push(a[0], 0, a[1], b[0], 0, b[1]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.brushPreview = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: this.brushErase ? '#b4483d' : '#3f7550', depthTest: false }));
    this.brushPreview.position.y = 0.05;
    this.brushPreview.renderOrder = 5;
    this.scene.add(this.brushPreview);
  }

  /** Zwalnia podgląd pędzla — wołane przy każdym odświeżeniu i przy sprzątaniu sceny. */
  private clearBrushPreview() {
    if (!this.brushPreview) return;
    this.scene.remove(this.brushPreview);
    this.brushPreview.geometry.dispose();
    (this.brushPreview.material as THREE.Material).dispose();
    this.brushPreview = null;
  }

  private groundPoint(out: THREE.Vector3): boolean {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return !!this.raycaster.ray.intersectPlane(this.groundPlane, out);
  }

  private isUiTarget(ev: Event) {
    const t = ev.target as HTMLElement | null;
    return !!t && t !== this.renderer.domElement && !this.labelRenderer.domElement.contains(t);
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (this.isUiTarget(ev)) return;
    const st = useStore.getState();
    if (this.mode === 'editor' && st.groundBrush && ev.button === 0) {
      this.setPointer(ev);
      this.brushErase = ev.shiftKey;
      this.brushTiles = new Map();
      this.brushLast = null;
      this.orbit.enabled = false;
      this.brushAt();
      return;
    }
    if (this.mode === 'vr') {
      if (!this.stereo) return;
      // bez czujników ruchu rozglądamy się myszą, więc najpierw przejmujemy kursor
      if (ev.pointerType === 'mouse' && !this.deviceOrient.active && document.pointerLockElement !== this.renderer.domElement) {
        this.renderer.domElement.requestPointerLock?.();
        return;
      }
      this.touchHold = true;
      this.touchStart = performance.now();
      this.vrLook = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false };
      return;
    }
    if (this.mode === 'fp') {
      if (ev.pointerType === 'touch') {
        // rozgląda całe płótno: gałka i przyciski to elementy DOM, które odsiewa `isUiTarget`
        this.touchLook.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, moved: false });
        return;
      }
      if (document.pointerLockElement === this.renderer.domElement) {
        // łuk przejmuje lewy przycisk: trzymanie napina cięciwę, puszczenie strzela
        if (this.archery && ev.button === 0) {
          this.archery.setPulling(true);
          return;
        }
        if (this.ghost) {
          // stawianie w spacerze: klik stawia w miejscu podglądu, prawy przycisk anuluje
          if (ev.button === 2) st.setPlacing(null);
          else this.commitPlacement(ev.shiftKey || this.stickyPlacing);
          return;
        }
        const id = this.pick(new THREE.Vector2(0, 0));
        this.fpInteract(id);
      } else {
        this.renderer.domElement.requestPointerLock?.();
      }
      return;
    }
    // edytor: tryb stawiania przechwytuje wszystkie kliknięcia
    if (this.ghost) {
      ev.stopPropagation();
      ev.preventDefault();
      this.setPointer(ev);
      this.updateGhost();
      if (ev.button === 2) {
        // prawy przycisk w trakcie rysowania ścianki cofa tylko jej początek
        if (this.drawing() && this.wallStart) {
          this.clearWallDraw();
          this.updateGhost();
        } else useStore.getState().setPlacing(null);
        return;
      }
      this.placeDown = { x: ev.clientX, y: ev.clientY };
      // ścianka zaczyna się już przy naciśnięciu, żeby przeciągnięcie działało jak dwa kliknięcia
      if (this.drawing() && !this.wallStart && (ev.button === 0 || ev.pointerType !== 'mouse')) this.startWall();
      return;
    }
    if (ev.button === 1 && ev.pointerType === 'mouse') {
      // bez preventDefault Windows włączyłby autoprzewijanie; propagacja zostaje, bo obraca OrbitControls
      ev.preventDefault();
      if (this.topView && !st.review && !this.freeLook) {
        this.freeLook = true;
        this.tween = null;
        this.orbit.minPolarAngle = 0;
        this.orbit.maxPolarAngle = 1.45;
        this.orbit.enableRotate = true;
        this.orbit.enableDamping = true;
      }
      return;
    }
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    this.setPointer(ev);
    // kliknięcie w uchwyt obsługuje TransformControls (nasz listener jest w fazie przechwytywania)
    if (this.gizmo.enabled || this.rotateGizmo.enabled) {
      // pointerHover oczekuje współrzędnych znormalizowanych; deklaracja w @types/three mówi PointerEvent
      const pointer = { x: this.pointer.x, y: this.pointer.y, button: ev.button } as unknown as PointerEvent;
      this.gizmo.pointerHover(pointer);
      this.rotateGizmo.pointerHover(pointer);
      // trafiony uchwyt przejmuje naciśnięcie, drugi milczy do puszczenia (strzałki mają pierwszeństwo)
      const winner = this.gizmo.axis ? this.gizmo : this.rotateGizmo.axis ? this.rotateGizmo : null;
      if (winner) {
        (winner === this.gizmo ? this.rotateGizmo : this.gizmo).enabled = false;
        this.gizmoArmed = true;
        this.downInfo = null;
        return;
      }
    }
    const hit = this.pick();
    this.downInfo = { x: ev.clientX, y: ev.clientY, hit, shift: ev.shiftKey };
    const tool = st.tool;
    if (tool === 'select') {
      // narzędzie „Zaznacz” nigdy nie rusza kamery myszą: puste miejsce zaczyna ramkę zaznaczenia
      // (na dotyku przeciągnięcie nadal obraca widok, bo ramka jest tylko dla myszy)
      if (ev.pointerType !== 'mouse') return;
      ev.stopPropagation();
      ev.preventDefault();
      if (!hit && !st.review) this.marquee = { x0: ev.clientX, y0: ev.clientY, shift: ev.shiftKey, el: null };
      return;
    }
    const targetId = hit ?? st.selectedIds[0] ?? null;
    if (targetId && !st.review) {
      const e = this.entries.get(targetId);
      if (!e) return;
      ev.stopPropagation();
      ev.preventDefault();
      const gp = new THREE.Vector3();
      this.groundPoint(gp);
      const offset = e.group.position.clone().sub(gp);
      // chwycony obiekt należący do zaznaczenia zbiorczego ciągnie za sobą całe zaznaczenie
      const group = hit && st.selectedIds.length > 1 && st.selectedIds.includes(hit) ? movableRoots(st.palace().objects, st.selectedIds) : null;
      this.drag = {
        id: targetId,
        offset,
        startX: ev.clientX,
        startY: ev.clientY,
        moved: false,
        ids: group ? group.map((o) => o.id) : undefined,
        starts: group ? new Map(group.map((o) => [o.id, [...o.position] as Vec3])) : undefined,
      };
      if (hit && !group) st.select(hit);
      this.renderer.domElement.style.cursor = 'grabbing';
    }
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (this.brushTiles) {
      this.setPointer(ev);
      this.brushAt();
      return;
    }
    // tryb stereo bez czujników: przeciągnięcie rozgląda się zamiast prowadzić do przodu
    if (
      this.mode === 'vr' &&
      this.vrLook &&
      ev.pointerId === this.vrLook.id &&
      !this.deviceOrient.active &&
      document.pointerLockElement !== this.renderer.domElement
    ) {
      const dx = ev.clientX - this.vrLook.x;
      const dy = ev.clientY - this.vrLook.y;
      this.vrLook.x = ev.clientX;
      this.vrLook.y = ev.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        this.vrLook.moved = true;
        this.touchHold = false;
      }
      this.look(dx * 0.006, dy * 0.006);
      return;
    }
    const look = this.mode === 'fp' ? this.touchLook.get(ev.pointerId) : undefined;
    if (look) {
      const dx = ev.clientX - look.x;
      const dy = ev.clientY - look.y;
      look.x = ev.clientX;
      look.y = ev.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) look.moved = true;
      this.look(dx * 0.006, dy * 0.006);
      return;
    }
    if (this.mode !== 'editor' || this.gizmoDragging) return;
    if (this.ghost) {
      if (ev.pointerType === 'mouse' || this.placeDown) {
        this.setPointer(ev);
        this.updateGhost();
      }
      return;
    }
    if (this.marquee) {
      const m = this.marquee;
      if (!m.el && Math.hypot(ev.clientX - m.x0, ev.clientY - m.y0) <= 5) return;
      if (!m.el) {
        m.el = document.createElement('div');
        m.el.className = 'marquee';
        this.container.appendChild(m.el);
      }
      ev.preventDefault();
      const r = this.container.getBoundingClientRect();
      m.el.style.left = `${Math.min(m.x0, ev.clientX) - r.left}px`;
      m.el.style.top = `${Math.min(m.y0, ev.clientY) - r.top}px`;
      m.el.style.width = `${Math.abs(ev.clientX - m.x0)}px`;
      m.el.style.height = `${Math.abs(ev.clientY - m.y0)}px`;
      return;
    }
    if (this.drag) {
      const st = useStore.getState();
      const e = this.entries.get(this.drag.id);
      if (!e) return;
      const dist = Math.hypot(ev.clientX - this.drag.startX, ev.clientY - this.drag.startY);
      if (!this.drag.moved && dist > 4) {
        this.drag.moved = true;
        st.pushUndo();
      }
      if (!this.drag.moved) return;
      ev.preventDefault();
      this.setPointer(ev);
      if (isFacade(e.type) && !this.drag.ids) {
        const gp = new THREE.Vector3();
        if (!this.groundPoint(gp)) return;
        const fo = st.palace().objects.find((x) => x.id === this.drag!.id);
        const found = fo ? this.findFacadeFor(fo.type, gp.x, gp.z, fo.anchorId) : null;
        if (!found?.hit || !fo) return;
        const floor = floorOfIn(found.b, fo.position[1]);
        if (!facadeFloorOk(fo.type, floor) || !facadeSlotFree(found.b, st.palace().objects, found.hit, fo.type, floor, fo.id)) return;
        st.updateObject(fo.id, { position: [found.hit.x, buildingFloorY(found.b, floor), found.hit.z], rotation: [0, found.hit.yaw, 0], anchorId: found.b.id }, { undo: false });
        return;
      }
      if (e.type === 'door' && !this.drag.ids) {
        // drzwi przesuwają się tylko po osi ścianki (tej samej albo innej pod kursorem)
        const gp = new THREE.Vector3();
        if (!this.groundPoint(gp)) return;
        const door = st.palace().objects.find((x) => x.id === this.drag!.id);
        const hit = this.findWallFor(gp.x, gp.z, door?.anchorId);
        if (!hit || !door || !doorSlotFree(hit.wall, st.palace().objects, hit.t, door.id)) return;
        st.updateObject(door.id, { position: [hit.x, hit.wall.position[1], hit.z], rotation: [0, doorYawOn(hit.wall, door), 0], anchorId: hit.wall.id }, { undo: false });
        return;
      }
      // przeciągane obiekty (i to, co na nich stoi) nie mogą być własną podstawą
      const dragged = this.drag.ids ?? [this.drag.id];
      const exclude = new Set<string>(dragged.flatMap((id) => [id, ...descendants(st.palace().objects, id).map((o) => o.id)]));
      const found = this.placementPoint(exclude);
      if (!found) return;
      const snap = st.palace().settings.grid ? 0.5 : 0.05;
      const onPlate = !this.walkArea || insideGround(this.walkArea, found.pos.x, found.pos.z);
      const x = found.anchorId || !onPlate ? found.pos.x : Math.round(found.pos.x / snap) * snap;
      const z = found.anchorId || !onPlate ? found.pos.z : Math.round(found.pos.z / snap) * snap;
      if (this.drag.ids && this.drag.starts) {
        // reszta zaznaczenia jedzie o tę samą różnicę w poziomie co chwycony obiekt
        const dragId = this.drag.id;
        const starts = this.drag.starts;
        const start = starts.get(dragId) ?? [x, found.pos.y, z];
        const dx = x - start[0];
        const dz = z - start[2];
        const list = this.drag.ids.map((id) => {
          if (id === dragId) return { id, patch: { position: [x, found.pos.y, z] as Vec3, anchorId: found.anchorId } };
          const s0 = starts.get(id)!;
          return { id, patch: { position: [s0[0] + dx, s0[1], s0[2] + dz] as Vec3 } };
        });
        st.updateObjects(list, { undo: false });
        return;
      }
      st.updateObject(this.drag.id, { position: [x, found.pos.y, z], anchorId: found.anchorId }, { undo: false });
      return;
    }
    if (ev.pointerType === 'mouse' && !this.isUiTarget(ev)) {
      this.setPointer(ev);
      const id = this.pick();
      const tool = useStore.getState().tool;
      useStore.getState().setHover(id);
      this.renderer.domElement.style.cursor = id ? (tool === 'select' ? 'pointer' : 'grab') : '';
    }
  };

  private onPointerUp = (ev: PointerEvent) => {
    // `pointercancel` nie podaje numeru przycisku, a cięciwa musi puścić także wtedy
    if (this.archery && (ev.button === 0 || ev.type === 'pointercancel')) this.archery.setPulling(false);
    if (this.brushTiles) {
      const painted = [...this.brushTiles.values()];
      this.brushTiles = null;
      this.brushLast = null;
      this.orbit.enabled = this.mode === 'editor';
      this.clearBrushPreview();
      useStore.getState().paintGroundTiles(painted, this.brushErase);
      return;
    }
    if (ev.button === 1 || ev.type === 'pointercancel') this.endFreeLook();
    if (this.gizmoArmed) {
      // uchwyty już zakończyły przeciąganie (słuchają na płótnie, my na oknie) — włączamy oba z powrotem
      this.gizmoArmed = false;
      this.syncGizmo();
    }
    if (this.mode === 'vr') {
      if (this.stereo && this.touchHold) {
        this.touchHold = false;
        if (!this.vrLook?.moved && performance.now() - this.touchStart < 250) this.onVrSelect();
      }
      this.vrLook = null;
      return;
    }
    if (this.mode === 'fp') {
      const up = this.touchLook.get(ev.pointerId);
      if (up) {
        this.touchLook.delete(ev.pointerId);
        // palec, który nie drgnął, był stuknięciem: stawia obiekt albo otwiera drzwi
        if (!up.moved) {
          if (this.ghost) this.commitPlacement(this.stickyPlacing);
          else {
            this.setPointer(ev);
            this.fpInteract(this.pick());
          }
        }
      }
      return;
    }
    if (this.mode !== 'editor') return;
    const st = useStore.getState();
    if (this.ghost && this.placeDown) {
      const moved = Math.hypot(ev.clientX - this.placeDown.x, ev.clientY - this.placeDown.y);
      const isTouch = ev.pointerType === 'touch';
      this.placeDown = null;
      if (this.drawing()) {
        // puszczenie po kliknięciu, które ustawiło początek, jeszcze nic nie stawia
        const started = this.wallStartedOnDown;
        this.wallStartedOnDown = false;
        if (started && moved < 6) return;
        this.setPointer(ev);
        this.updateGhost();
        this.commitPlacement(ev.shiftKey || this.stickyPlacing);
        return;
      }
      if (isTouch || moved < 6) this.commitPlacement(ev.shiftKey || this.stickyPlacing);
      return;
    }
    if (this.drag) {
      this.drag = null;
      this.renderer.domElement.style.cursor = '';
      this.downInfo = null;
      return;
    }
    if (this.marquee) {
      const m = this.marquee;
      this.marquee = null;
      if (m.el) {
        m.el.remove();
        const ids = this.idsInRect(Math.min(m.x0, ev.clientX), Math.min(m.y0, ev.clientY), Math.max(m.x0, ev.clientX), Math.max(m.y0, ev.clientY));
        st.setSelection(m.shift ? [...st.selectedIds, ...ids] : ids);
        this.downInfo = null;
        return;
      }
      // bez ruchu to zwykłe kliknięcie w puste miejsce — obsługa niżej
    }
    if (this.downInfo) {
      const moved = Math.hypot(ev.clientX - this.downInfo.x, ev.clientY - this.downInfo.y) > 5;
      if (!moved && !this.isUiTarget(ev)) {
        const hit = this.downInfo.hit;
        if (hit) {
          const now = performance.now();
          const dbl = this.lastClick && this.lastClick.id === hit && now - this.lastClick.t < 350;
          this.lastClick = { id: hit, t: now };
          const type = this.lastPalace?.objects.find((o) => o.id === hit)?.type;
          const grouped = !!this.lastPalace?.objects.find((o) => o.id === hit)?.groupId;
          if (dbl && type && hasInterior(type)) {
            this.lastClick = null;
            st.enterInterior(hit);
          } else if (dbl && grouped) {
            // dwuklik wchodzi do grupy: zaznacza sam obiekt, żeby dało się edytować jego notatkę
            this.lastClick = null;
            st.selectOnly(hit);
          } else if (this.downInfo.shift) st.toggleSelected(hit);
          else st.select(hit);
          // klik w budynek z wnętrzem w miejscu (albo w coś w nim) odsłania go; klik w pustkę zakrywa
          const clicked = this.lastPalace?.objects.find((o) => o.id === hit);
          if (clicked && this.lastPalace && !this.lastPalace.interior) {
            const b = isInPlace(clicked) ? clicked : buildingOf(this.lastPalace.objects, clicked);
            if (b) st.setActiveBuilding(b.id);
          }
        } else if (!st.review && !this.downInfo.shift) {
          st.select(null);
          st.setActiveBuilding(null);
        }
      }
      this.downInfo = null;
    }
  };

  /** Obiekty, których punkt zaczepienia wypada w prostokącie ekranu (współrzędne strony). */
  private idsInRect(x1: number, y1: number, x2: number, y2: number): string[] {
    this.camera.updateMatrixWorld();
    const r = this.renderer.domElement.getBoundingClientRect();
    const out: string[] = [];
    for (const [id, e] of this.entries) {
      if (!e.group.visible) continue;
      const v = tmpV.copy(e.group.position).project(this.camera);
      if (v.z > 1) continue;
      const sx = r.left + ((v.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - v.y) / 2) * r.height;
      if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) out.push(id);
    }
    return out;
  }

  private fpInteract(id: string | null) {
    if (this.riding) {
      if (MOUNT_SPECS[this.ride!.mount].kind === 'hover') this.rideInput.fire = true;
      return;
    }
    if (this.descent) return;
    const st = useStore.getState();
    // zaczepienie zwierzęcia: reaguje, a jeśli punkt ma notatkę, obsługujemy ją dalej jak zwykle
    if (id) this.wildlife.poke(id);
    // klik wprost w skrzydło drzwi obiektowych w zasięgu — niezależnie od aktualnej podpowiedzi
    if (id) {
      const e = this.entries.get(id);
      if (e?.doorPivot && this.doorDistance(e) < 2.6 && (e.type === 'door' || this.pickPoint.distanceTo(this.doorWorld(e)) < 0.7 * hs(e) + 0.5)) {
        this.toggleDoor(id);
        return;
      }
    }
    // najpierw drzwi: kliknięcie w budynek lub w skrzydło drzwi wnętrza
    const dp = st.doorPrompt;
    if (dp && (id === null || id === dp.objectId || this.pickedExitDoor)) {
      if (id === dp.objectId || this.pickedExitDoor) {
        this.useDoor();
        return;
      }
    }
    if (st.review) {
      const cur = st.review.stops[st.review.index];
      if (!id || id === cur.objectId) {
        if (st.review.finished) return;
        if (!st.review.revealed) st.reveal();
        else st.nextStop();
        return;
      }
    }
    st.select(id);
  }

  private look(dx: number, dy: number) {
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.3, 1.3);
    if (this.riding) {
      // w kokpicie obrót prowadzi maszyna: rozglądanie zostaje w kamerze, względem kadłuba
      this.yaw = THREE.MathUtils.clamp(this.yaw - dx, -2.2, 2.2);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      return;
    }
    this.yaw -= dx;
    this.rig.rotation.y = this.yaw;
    this.camera.rotation.set(this.pitch, 0, 0);
  }

  private onMouseMoveLocked = (ev: MouseEvent) => {
    if (document.pointerLockElement !== this.renderer.domElement) return;
    // rozglądanie myszą: w widoku z oczu zawsze, w trybie stereo tylko gdy głowy nie prowadzą czujniki
    const stereoLook = this.mode === 'vr' && !!this.stereo && !this.deviceOrient.active;
    if (this.mode !== 'fp' && !stereoLook) return;
    // przy naciągu kamera chodzi wolniej — łuk ma się celować, a nie śmigać
    const k = this.archery ? 1 - 0.35 * this.archery.draw : 1;
    this.look(ev.movementX * 0.0022 * k, ev.movementY * 0.0022 * k);
  };

  private onContextMenu = (ev: MouseEvent) => {
    if (this.ghost) ev.preventDefault();
  };

  /** W trybie stawiania kółko obraca podgląd zamiast przybliżać widok. */
  private onWheel = (ev: WheelEvent) => {
    if (!this.ghost) return;
    ev.preventDefault();
    ev.stopPropagation();
    // obrót ścianki wynika z punktów, obrót drzwi ze ścianki
    if ((this.drawing()) || isFacade(this.ghostType)) return;
    if (this.ghostType === 'door') {
      this.doorFlip = !this.doorFlip;
      this.updateGhost();
      return;
    }
    this.ghostRot += Math.sign(ev.deltaY) * (Math.PI / 12);
    this.ghostAutoRot = false;
    this.updateGhost();
  };

  private onLockChange = () => {
    useStore.setState({ toast: null });
    if (document.pointerLockElement !== this.renderer.domElement) this.archery?.setPulling(false);
    this.container.classList.toggle('pointer-locked', document.pointerLockElement === this.renderer.domElement);
  };

  private isTyping() {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }

  private onKeyDown = (ev: KeyboardEvent) => {
    if (this.isTyping()) return;
    this.keys.add(ev.code);
    const st = useStore.getState();
    const meta = ev.ctrlKey || ev.metaKey;
    if (meta && ev.code === 'KeyZ') {
      ev.preventDefault();
      if (ev.shiftKey) st.redo();
      else st.undo();
      return;
    }
    if (meta && ev.code === 'KeyY') {
      ev.preventDefault();
      st.redo();
      return;
    }
    if (meta && ev.code === 'KeyD' && st.selectedIds.length > 0) {
      ev.preventDefault();
      st.duplicateSelected();
      return;
    }
    if (this.ghost) {
      if (ev.code === 'KeyR') {
        ev.preventDefault();
        if (this.ghostType === 'door') this.doorFlip = !this.doorFlip; // zawiasy z drugiej strony
        else if (!this.drawing() && !isFacade(this.ghostType)) {
          this.ghostRot += Math.PI / 12;
          this.ghostAutoRot = false;
        }
        this.updateGhost();
        return;
      }
      if (ev.code === 'Escape') {
        if (this.drawing() && this.wallStart) {
          this.clearWallDraw();
          this.updateGhost();
        } else st.setPlacing(null);
        return;
      }
    }
    if (this.mode === 'editor') {
      if ((ev.code === 'Delete' || ev.code === 'Backspace') && st.selectedIds.length > 0 && !st.review) {
        ev.preventDefault();
        st.removeObjects(st.selectedIds);
      }
      if (ev.code === 'KeyV') st.setTool('select');
      if (ev.code === 'KeyM') st.setTool('move');
      if (ev.code === 'KeyF') st.camera('center');
      if (ev.code === 'KeyT') st.camera('topView');
    }
    if (ev.code === 'KeyB' && this.mode === 'fp' && !st.review) {
      ev.preventDefault();
      this.toggleBow();
      return;
    }
    if (ev.code === 'KeyF' && this.mode === 'fp' && this.riding) {
      ev.preventDefault();
      this.leaveMount();
      return;
    }
    if (ev.code === 'KeyF' && this.mode === 'fp') {
      if (this.useDoor()) {
        ev.preventDefault();
        return;
      }
    }
    if (ev.code === 'Escape') {
      if (st.groundBrush) st.setGroundBrush(false);
      else if (st.review && this.mode !== 'vr') st.endReview();
      else st.select(null);
    }
    // Spacja to zawsze skok; w spacerze do przodu przechodzimy Enterem albo kliknięciem
    if (ev.code === 'Space' && this.mode !== 'editor') {
      ev.preventDefault();
      this.jump();
    }
    if (ev.code === 'Enter' && this.mode === 'fp' && st.review) {
      ev.preventDefault();
      if (!st.review.revealed) st.reveal();
      else st.nextStop();
    }
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    this.keys.delete(ev.code);
  };

  // ---------- pętla ----------
  /**
   * Ustawia pulę na `qspec.pointLights` świateł. Wołane raz przy budowie sceny i przy zmianie jakości —
   * tylko wtedy wolno zmienić liczbę świateł, bo to jedyny moment, w którym rekompilacja materiałów
   * jest akceptowalna (tak samo jak przy włączeniu cieni).
   */
  private buildLightPool() {
    const want = this.qspec.pointLights;
    while (this.lightPool.length > want) this.scene.remove(this.lightPool.pop()!);
    while (this.lightPool.length < want) {
      const l = new THREE.PointLight('#ffffff', 0, 8, 2);
      l.castShadow = false;
      this.scene.add(l);
      this.lightPool.push(l);
    }
    this.lightSlots = this.lightSlots.slice(0, want);
  }

  /**
   * Obsadza miejsca puli źródłami najbliższymi kamerze. Liczba świateł w scenie się nie zmienia — miejsce
   * bez źródła po prostu ma natężenie 0. Wybór odświeżamy co kilka klatek (kolejność nie zmienia się w ciągu
   * jednego kroku), a natężenie dochodzi do celu płynnie: zgaszenie latarni z klatki na klatkę byłoby nocą
   * widoczne jako mrugnięcie.
   */
  private updatePointLights(dt: number, camPos: THREE.Vector3) {
    if (++this.lightTick % 6 === 1) {
      this.lightSources.clear();
      const sources: { id: string; score: number }[] = [];
      for (const e of this.entries.values()) {
        if (e.lights.length === 0 || !e.group.visible) continue;
        for (const l of e.lights) {
          this.lightSources.set(l.uuid, l);
          // im dalej od zasięgu światła, tym mniej widać jego plamę — stąd odległość pomniejszona o zasięg
          sources.push({ id: l.uuid, score: l.getWorldPosition(lightPosTmp).distanceTo(camPos) - l.distance });
        }
      }
      this.lightSlots = assignSlots(this.lightSlots, sources, this.lightPool.length, (i) => this.lightPool[i].intensity < 0.02);
    }
    const k = 1 - Math.exp(-dt * 8);
    for (let i = 0; i < this.lightPool.length; i++) {
      const lamp = this.lightPool[i];
      const slot = this.lightSlots[i];
      const src = slot?.source ? this.lightSources.get(slot.source) : undefined;
      // barwę i zasięg przepisujemy co klatkę: źródło może się poruszać (światło pod taksówką) albo zmienić model
      if (src) {
        lamp.color.copy(src.color);
        lamp.distance = src.distance;
        lamp.decay = src.decay;
        src.getWorldPosition(lamp.position);
      }
      const target = src && slot.on ? (src.userData.baseIntensity as number) : 0;
      if (lamp.intensity !== target) {
        lamp.intensity += (target - lamp.intensity) * k;
        if (Math.abs(lamp.intensity - target) < 0.02) lamp.intensity = target;
      }
    }
  }

  /**
   * Ustawia mapę cienia słońca na kwadrat o boku `2 × half` wokół punktu (`cx`, `cz`). W edytorze obejmuje całą
   * planszę, w spacerze idzie za graczem — na planszy 80 m cały świat w jednej mapie oznaczałby cień
   * czterokrotnie mniej dokładny i przerysowywanie wszystkich brył co klatkę.
   *
   * Ognisko przyciągamy do siatki tekseli mapy (w osiach światła, nie świata) — bez tego krawędzie cieni
   * pełzłyby przy każdym kroku gracza.
   */
  private applySunShadow(cx: number, cz: number, half: number) {
    const texel = (2 * half) / (this.sun.shadow.mapSize.x || 1024);
    const right = sunRight.set(0, 1, 0).cross(SUN_DIR).normalize();
    const up = sunUp.copy(SUN_DIR).cross(right).normalize();
    const focus = sunFocusTmp.set(cx, 0, cz);
    const a = Math.round(focus.dot(right) / texel) * texel;
    const b = Math.round(focus.dot(up) / texel) * texel;
    const c = focus.dot(SUN_DIR);
    focus.set(0, 0, 0).addScaledVector(right, a).addScaledVector(up, b).addScaledVector(SUN_DIR, c);
    if (this.sunHalf === half && this.sunFocus.equals(focus)) return;
    this.sunHalf = half;
    this.sunFocus.copy(focus);
    const dist = half * 2 + 24; // światło musi być nad najwyższą bryłą, którą obejmuje mapa
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sun.position.copy(focus).addScaledVector(SUN_DIR, dist);
    const cam = this.sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = dist * 2;
    cam.updateProjectionMatrix();
  }

  /** Kwadrat mapy cienia: w edytorze cała plansza, w spacerze okolica gracza. */
  private syncSunShadow(camPos: THREE.Vector3, presenting: boolean) {
    // `bounds` to obrys planszy liczony przy jej budowie — po kafelkach nie ma co chodzić co klatkę
    const plate = Math.max(this.bounds.hx, this.bounds.hz) + 2.4;
    if (this.mode === 'editor' || plate <= WALK_SHADOW_HALF) {
      this.applySunShadow(0, 0, plate);
      return;
    }
    // przesuwamy kwadrat przed gracza: za plecami cieni i tak nie widać, a przed sobą widać je do końca planszy
    // w goglach kierunek patrzenia podaje kamera XR, nie ta z edytora
    const fwd = (presenting ? this.renderer.xr.getCamera() : this.camera).getWorldDirection(fwdTmp);
    const len = Math.hypot(fwd.x, fwd.z) || 1;
    this.applySunShadow(camPos.x + (fwd.x / len) * WALK_SHADOW_HALF * 0.5, camPos.z + (fwd.z / len) * WALK_SHADOW_HALF * 0.5, WALK_SHADOW_HALF);
  }

  private frame(frame?: XRFrame) {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const presenting = this.renderer.xr.isPresenting;

    // Automat rozdzielczości: żaden preset nie zgadnie, że sześć domów w deszczu kosztuje
    // wielokrotnie więcej niż pusta plansza. W VR nie ruszamy — bufor należy do gogli.
    this.frameMs += (dt * 1000 - this.frameMs) * 0.1;
    if (!presenting && --this.scaleHold <= 0) {
      const s = nextScale(this.renderScale, this.frameMs, this.qspec.minScale);
      this.scaleHold = 60; // sama zmiana rozmiaru bufora kosztuje klatkę, więc nie częściej niż co sekundę
      if (s !== this.renderScale) {
        this.renderScale = s;
        this.applyQuality();
        this.resize();
      }
    }

    if (this.doorAnims.length > 0) {
      for (const a of this.doorAnims) {
        a.t = Math.min(a.t + dt, a.dur);
        const e = this.entries.get(a.id);
        if (e?.doorPivot) e.doorPivot.rotation.y = a.from + (a.to - a.from) * (a.t / a.dur);
      }
      this.doorAnims = this.doorAnims.filter((a) => a.t < a.dur);
    }

    if (this.mode === 'editor') {
      if (this.tween) {
        const tw = this.tween;
        tw.t += dt;
        const k = Math.min(tw.t / tw.dur, 1);
        const s = k * k * (3 - 2 * k);
        this.camera.position.lerpVectors(tw.fromPos, tw.toPos, s);
        this.orbit.target.lerpVectors(tw.fromTarget, tw.toTarget, s);
        if (k >= 1) {
          this.tween = null;
          tw.onDone?.();
        }
      }
      this.orbit.update();
    } else if (this.mode === 'fp' || this.mode === 'vr') {
      if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      // w goglach kontrolery i pad działają równolegle: pada można trzymać, gdy kontrolery leżą na biurku
      if (presenting) this.readXrInput();
      this.readGamepad(dt);
      if (this.ride) this.updateRide(dt);
      if (this.descent) this.updateDescent(dt);
      else if (!this.riding) this.updateFp(dt);
      if (this.archery) this.updateArchery(dt);
      if (this.debugPhysics && ++this.debugTick % 10 === 0) this.updatePhysicsDebug();
      if (this.stereo && this.deviceOrient.active) this.applyDeviceOrientation();
    }

    if (this.mode !== 'editor' && ++this.doorCheck % 6 === 0) {
      this.updateDoorPrompt();
      if (!this.riding && !this.descent) this.updateInsideBuilding();
    }
    // spacer: podgląd stawianego obiektu idzie za celownikiem (środek ekranu)
    if (this.ghost && this.mode === 'fp' && !this.riding && !this.descent) {
      this.pointer.set(0, 0);
      this.updateGhost();
    }

    // aktywny budynek z wnętrzem w miejscu: ściany od strony kamery znikają (normalna obrócona obrotem budynku)
    const activeB = this.activeBuilding();
    const activeE = activeB ? this.entries.get(activeB.id) : undefined;
    if (activeB && activeE) {
      const yaw = activeB.rotation[1];
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const dx = this.camera.position.x - activeB.position[0];
      const dz = this.camera.position.z - activeB.position[2];
      for (const w of activeE.walls) {
        const n = w.userData.wallNormal as [number, number];
        const nx = n[0] * cos + n[1] * sin;
        const nz = -n[0] * sin + n[1] * cos;
        // ściana znika, gdy jej zewnętrzna normalna choć trochę celuje w kamerę (cos > 0,05): przy widoku po przekątnej
        // druga bliska ściana ma kosinus ~0,15 i przy wyższym progu zasłaniałaby połowę wnętrza
        w.visible = nx * dx + nz * dz < 0.05 * Math.hypot(dx, dz);
      }
    }
    // we wnętrzu w edytorze chowamy ściany od strony kamery (widok jak do domku dla lalek) i wyższe piętra
    if (this.room) {
      const inEditor = this.mode === 'editor';
      const editFloor = useStore.getState().editFloor;
      for (const wmesh of [...this.room.walls, ...this.room.windows]) {
        if (!inEditor) {
          wmesh.visible = true;
          continue;
        }
        if ((wmesh.userData.floorIndex as number) > editFloor) {
          wmesh.visible = false;
          continue;
        }
        const n = wmesh.userData.wallNormal as [number, number];
        const dir = tmpV.set(this.camera.position.x, 0, this.camera.position.z);
        wmesh.visible = n[0] * dir.x + n[1] * dir.z < 0.5;
      }
    }

    // pogoda (raz na klatkę, także gdy stereo renderuje scenę dwukrotnie)
    const camWorldPos = presenting ? this.renderer.xr.getCamera().getWorldPosition(tmpV3) : this.camera.getWorldPosition(tmpV3);
    this.updatePointLights(dt, camWorldPos);
    this.syncSunShadow(camWorldPos, presenting);
    const hadFlash = this.weather.flash;
    this.weather.update(dt, camWorldPos);
    if (hadFlash !== this.weather.flash) this.applyLighting();
    if (hadFlash === 0 && this.weather.flash > 0) this.sounds.thunder();
    this.sounds.update(dt);
    for (const e of this.entries.values()) {
      e.emitter?.update(dt, camWorldPos);
      e.anim?.mixer.update(dt);
    }
    if (this.mode !== 'editor' && this.wildlife.creatures.length > 0) {
      // świat przeliczamy rzadziej niż ruch zwierząt — obiekty i tak stoją w miejscu
      if (++this.wildlifeTick % 30 === 0) this.cachedWorld = this.worldInfo();
      this.wildlife.update(dt, this.rig.position, this.cachedWorld ?? (this.cachedWorld = this.worldInfo()));
    }

    // billboardy paneli
    if (this.mode !== 'editor') {
      const camWorld = presenting ? this.renderer.xr.getCamera().getWorldPosition(tmpV2) : this.camera.getWorldPosition(tmpV2);
      for (const e of this.entries.values()) {
        if (!e.panel) continue;
        const gp = this.wildlife.positionOf(e.id) ?? e.group.position;
        if (e.panel.userData.current) {
          const dir = tmpV.set(camWorld.x - gp.x, 0, camWorld.z - gp.z);
          if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
          dir.normalize();
          const d = (e.footprint + 0.5) * hs(e);
          e.panel.position.set(gp.x + dir.x * d, Math.max(EYE + 0.15, gp.y + 0.6), gp.z + dir.z * d);
        } else {
          e.panel.position.set(gp.x, gp.y + e.height * e.group.scale.y + 0.6, gp.z);
        }
        tmpE.set(0, Math.atan2(camWorld.x - e.panel.position.x, camWorld.z - e.panel.position.z), 0);
        e.panel.quaternion.setFromEuler(tmpE);
      }
    }

    void frame;
    if (this.stereo && !presenting) {
      this.stereo.render(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
      if (this.mode === 'editor') this.labelRenderer.render(this.scene, this.camera);
    }
    this.syncLoadingScreen();
  }

  /**
   * Ekran ładowania znika po narysowanej klatce, a wraca na czas wczytywania fizyki albo modeli z plików.
   * Podczas odroczonej budowy pałacu (`loadingHold`) magazyn sam trzyma ekran — scena go wtedy nie rusza.
   */
  private syncLoadingScreen() {
    const st = useStore.getState();
    if (st.loadingHold) return;
    let want = this.pendingLoads.has('physics') ? 'Wczytywanie fizyki…' : this.pendingLoads.size > 0 ? 'Wczytywanie modeli…' : null;
    // zawieszone pobieranie (sieć bez odrzucenia obietnicy) nie może zasłaniać sceny w nieskończoność
    if (want) {
      if (!this.loadingSince) this.loadingSince = performance.now();
      else if (performance.now() - this.loadingSince > LOADING_TIMEOUT_MS) want = null;
    } else this.loadingSince = 0;
    if (st.loading !== want) st.setLoading(want);
  }

  /** Opis otoczenia dla zwierząt: przeszkody, miejsca do siadania i ukształtowanie terenu. */
  /**
   * Obrysy obiektów w poziomie: prostokąt z ramki modelu obrócony jak obiekt, z podłogą i szczytem. Drzewa
   * i inne pnie dają tylko pień (pod koroną da się przejść), zwierzęta i rzeczy bez bryły — nic.
   */
  private obstacles(): Obstacle[] {
    if (this.obstacleCache) return this.obstacleCache;
    const list: Obstacle[] = [];
    for (const e of this.entries.values()) {
      if (spawnKind(e.type) || !e.group.visible) continue;
      const kind = colliderKind(e.type);
      if (kind === 'none') continue;
      const p = e.group.position;
      const s = e.group.scale;
      const yaw = e.group.rotation.y;
      if (kind === 'cylinder') {
        const r = Math.max(e.footprint * 0.3, 0.2) * hs(e);
        list.push({ id: e.id, x: p.x, z: p.z, yaw: 0, hx: r, hz: r, bottom: p.y, top: p.y + e.height * s.y });
        continue;
      }
      const b = e.bounds;
      if (b.isEmpty()) continue;
      // środek obrysu w świecie: przesunięcie z modelu przeskalowane i obrócone razem z obiektem
      const world = (lx: number, lz: number) => {
        const cx = lx * s.x;
        const cz = lz * s.z;
        return [p.x + cx * Math.cos(yaw) + cz * Math.sin(yaw), p.z - cx * Math.sin(yaw) + cz * Math.cos(yaw)] as const;
      };
      const [wx, wz] = world((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
      list.push({
        id: e.id,
        x: wx,
        z: wz,
        yaw,
        hx: ((b.max.x - b.min.x) / 2) * s.x,
        hz: ((b.max.z - b.min.z) / 2) * s.z,
        bottom: p.y + b.min.y * s.y,
        top: p.y + b.max.y * s.y,
        slices: e.slices.length > 1 ? e.slices.map((sl) => {
          const [sx, sz] = world(sl.cx, sl.cz);
          return { top: p.y + sl.top * s.y, x: sx, z: sz, hx: sl.hx * s.x, hz: sl.hz * s.z };
        }) : undefined,
      });
    }
    this.obstacleCache = list;
    return list;
  }

  private worldInfo(): WorldInfo {
    const obstacles = this.obstacles();
    const perches: WorldInfo['perches'] = [];
    for (const e of this.entries.values()) {
      if (spawnKind(e.type)) continue;
      const top = e.group.position.y + e.height * e.group.scale.y;
      if (e.type === 'tree' || e.type === 'cypress' || e.type === 'palm') perches.push({ x: e.group.position.x, y: top * 0.75, z: e.group.position.z, kind: 'tree' });
      else if (hasInterior(e.type)) perches.push({ x: e.group.position.x, y: top * 0.9, z: e.group.position.z, kind: 'roof' });
      else if (e.type === 'bench' || e.type === 'rock') perches.push({ x: e.group.position.x, y: top, z: e.group.position.z, kind: 'seat' });
    }
    return {
      obstacles,
      perches,
      heightAt: (x, z) => {
        if (this.walkArea && insideGround(this.walkArea, x, z)) return 0;
        return this.terrain?.heightAt(x, z) ?? 0;
      },
      // zwierzęta chodzą tam, gdzie gracz: pies biegnący za Tobą nie ma stawać na krawędzi planszy
      clamp: (x, z) => this.clampWalk(x, z),
    };
  }

  /** W edytorze widać markery, w trybie chodzenia — żywe zwierzęta. */
  private syncWildlife() {
    const p = this.lastPalace;
    if (!p) return;
    const live = this.mode !== 'editor';
    const spawns: SpawnInfo[] = [];
    for (const o of p.objects) {
      const kind = spawnKind(o.type);
      if (!kind) continue;
      const e = this.entries.get(o.id);
      if (e) e.group.visible = this.entryVisible(e);
      if (live) spawns.push({ id: o.id, kind, pos: new THREE.Vector3(o.position[0], o.position[1], o.position[2]) });
    }
    this.wildlife.sync(spawns, this.worldInfo());
  }

  /** Szuka drzwi w zasięgu ręki i publikuje podpowiedź do interfejsu. */
  /**
   * Podpowiedź drzwi: promień z celownika (środek widoku) musi trafić w drzwi z odległości do 3 m.
   * Sama bliskość nie wystarcza, a ścianka albo mur budynku zasłaniają drzwi za sobą.
   */
  private updateDoorPrompt() {
    const st = useStore.getState();
    const p = this.lastPalace;
    if (!p) return;
    if (this.descent) {
      st.setDoorPrompt(null);
      return;
    }
    if (this.riding) {
      const r = this.ride!;
      const rs = r.state;
      // zsiąść można wszędzie, gdzie da się stanąć — czyli na płycie, a przy krajobrazie także na terenie
      const ready = rs.onGround && Math.abs(rs.speed) < 1.2 && (!!this.terrain || !this.walkArea || insideGround(this.walkArea, rs.x, rs.z));
      st.setDoorPrompt(ready ? { kind: 'leave', objectId: r.id, label: MOUNT_SPECS[r.mount].labels.leave } : null);
      return;
    }
    const mount = this.mountInReach();
    if (mount && isMount(mount.type)) {
      const o = p.objects.find((x) => x.id === mount.id);
      st.setDoorPrompt({ kind: 'board', objectId: mount.id, label: `${MOUNT_SPECS[mount.type].labels.board}: ${o?.name ?? catalogItem(mount.type).name}` });
      return;
    }
    const cam = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    this.raycaster.setFromCamera(tmpNdc.set(0, 0), cam);
    this.raycaster.far = 3.0;
    const targets: THREE.Object3D[] = [];
    for (const e of this.entries.values()) {
      if (!e.group.visible) continue;
      if (e.type === 'door' || e.type === 'wall' || hasInterior(e.type)) targets.push(e.group);
    }
    if (this.room?.exitDoor) targets.push(this.room.exitDoor);
    const hits = this.raycaster.intersectObjects(targets, true);
    this.raycaster.far = Infinity;
    let prompt: { kind: 'enter' | 'exit' | 'door'; objectId?: string; label: string } | null = null;
    for (const h of hits) {
      if (!isShown(h.object) || h.object.userData.noPick) continue;
      if (h.object.userData.exitDoor) {
        prompt = { kind: 'exit', label: 'Wyjdź na zewnątrz' };
        break;
      }
      const id = h.object.userData.objectId as string | undefined;
      const e = id ? this.entries.get(id) : undefined;
      if (!e) continue;
      if (e.type === 'door') {
        prompt = { kind: 'door', objectId: e.id, label: this.openDoors.has(e.id) ? 'Zamknij drzwi' : 'Otwórz drzwi' };
        break;
      }
      if (hasInterior(e.type)) {
        // budynek: liczy się trafienie w pobliże drzwi, nie w dowolną ścianę
        const near = h.point.distanceTo(this.doorWorld(e)) < 0.7 * hs(e) + 0.5;
        const o = p.objects.find((x) => x.id === e.id);
        if (near && o) {
          if (e.doorPivot) prompt = { kind: 'door', objectId: e.id, label: this.openDoors.has(e.id) ? 'Zamknij drzwi' : 'Otwórz drzwi' };
          else if (!e.inplace) prompt = { kind: 'enter', objectId: e.id, label: `Wejdź do: ${o.name}` };
        }
      }
      break; // ścianka albo mur zasłania to, co za nimi
    }
    st.setDoorPrompt(prompt);
  }

  /** Punkt drzwi wpisu w świecie: środek obiektu dla drzwi z Konstrukcji, próg z `DOORS` dla budynku. */
  private doorWorld(e: Entry): THREE.Vector3 {
    const spec = e.type === 'door' ? null : DOORS[e.type]?.local;
    return spec ? e.group.localToWorld(tmpV.set(spec[0], spec[1], spec[2])) : tmpV.copy(e.group.position);
  }

  private doorDistance(e: Entry): number {
    const dw = this.doorWorld(e);
    return Math.hypot(dw.x - this.rig.position.x, dw.z - this.rig.position.z);
  }

  /** Wchodzi, wychodzi albo otwiera/zamyka drzwi, na których stoi podpowiedź. */
  useDoor(): boolean {
    const st = useStore.getState();
    const dp = st.doorPrompt;
    if (!dp) return false;
    if (dp.kind === 'board' && dp.objectId) this.boardMount(dp.objectId);
    else if (dp.kind === 'leave') this.leaveMount();
    else if (dp.kind === 'exit') st.exitInterior();
    else if (dp.kind === 'door' && dp.objectId) this.toggleDoor(dp.objectId);
    else if (dp.objectId) st.enterInterior(dp.objectId);
    return true;
  }

  /** Otwiera albo zamyka skrzydło drzwi obiektowych: krótki obrót pivotu i (od)tworzenie kolizji skrzydła. */
  private toggleDoor(id: string) {
    const e = this.entries.get(id);
    if (!e?.doorPivot) return;
    const opening = !this.openDoors.has(id);
    if (opening) this.openDoors.add(id);
    else this.openDoors.delete(id);
    this.doorAnims = this.doorAnims.filter((a) => a.id !== id);
    this.doorAnims.push({ id, from: e.doorPivot.rotation.y, to: opening ? -(Math.PI * 100) / 180 : 0, t: 0, dur: 0.35 });
    const o = this.lastPalace?.objects.find((x) => x.id === id);
    if (this.physics && o) this.physics.setLeaf(id, !opening, e.group.position, e.group.quaternion, e.group.scale, leafFor(o.type));
  }

  /**
   * Zwykły pad (DualSense, Xbox) przez Gamepad API: lewa gałka chodzi, prawa rozgląda, krzyżyk skacze,
   * kwadrat i kółko otwierają drzwi albo wysadzają z samolotu, spusty biegną. Kontrolery gogli mają
   * własną ścieżkę w `readXrInput` — tu czytamy pady tylko poza sesją XR.
   */
  private readGamepad(dt: number) {
    const list = navigator.getGamepads?.() ?? [];
    let gp: Gamepad | null = null;
    for (const g of list) if (g?.connected && g.mapping === 'standard') gp = gp ?? g;
    for (const g of list) if (g?.connected) gp = gp ?? g;
    if (!gp) {
      this.pad.x = 0;
      this.pad.y = 0;
      this.padSprint = false;
      this.padThrottle = 0;
      this.padYaw = 0;
      this.padHeld.clear();
      return;
    }
    if (!this.padSeen) {
      this.padSeen = true;
      useStore.getState().setPadSeen();
      useStore.getState().showToast('Pad podłączony: lewa gałka chodzi, prawa rozgląda, ✕ skacze, ▢ otwiera drzwi.');
    }
    // martwa strefa liczona proporcjonalnie, żeby zaraz za nią ruch zaczynał się od zera, a nie skokiem
    const dead = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    this.pad.x = dead(gp.axes[0] ?? 0);
    this.pad.y = dead(gp.axes[1] ?? 0);
    const lookX = dead(gp.axes[2] ?? 0);
    const lookY = dead(gp.axes[3] ?? 0);
    if (this.renderer.xr.isPresenting) {
      // w goglach głową kieruje headset: prawa gałka obraca skokowo, tak samo jak kontroler
      if (Math.abs(lookX) > 0.6 && !this.padTurnArmed) {
        this.padTurnArmed = true;
        this.snapTurn(lookX);
      } else if (Math.abs(lookX) < 0.3) this.padTurnArmed = false;
    } else if (lookX !== 0 || lookY !== 0) this.look(lookX * 2.6 * dt, lookY * 2.0 * dt);
    const down = (i: number) => !!gp.buttons[i]?.pressed;
    const edge = (i: number) => {
      if (!down(i)) {
        this.padHeld.delete(i);
        return false;
      }
      if (this.padHeld.has(i)) return false;
      this.padHeld.add(i);
      return true;
    };
    // spusty są analogowe: w locie dają płynny gaz, na piechotę wystarczy sam fakt wciśnięcia
    const trigger = (i: number) => {
      const b = gp.buttons[i];
      if (!b) return 0;
      const v = b.value > 0 ? b.value : b.pressed ? 1 : 0;
      return v < 0.08 ? 0 : v;
    };
    this.padThrottle = trigger(7) - trigger(6);
    this.padYaw = (down(5) ? 1 : 0) - (down(4) ? 1 : 0);
    this.padSprint = down(6) || down(7) || down(10);
    const jump = edge(0);
    const useA = edge(2);
    const useB = edge(1);
    // w kokpicie ✕ nic nie robi; na koniu i czerwiu skacze; w spadku otwiera spadochron
    if (jump && (!this.riding || MOUNT_SPECS[this.ride!.mount].kind === 'ground')) this.jump();
    if (edge(3) && this.riding && MOUNT_SPECS[this.ride!.mount].kind === 'hover') this.rideInput.fire = true; // △ — smok zionie ogniem
    if (useA || useB) {
      if (this.riding) this.leaveMount();
      else this.useDoor();
    }
    // krzyżak w locie dokłada i ujmuje gazu
    if (edge(12)) this.throttleStep(0.1);
    if (edge(13)) this.throttleStep(-0.1);
  }

  /** Joystick lewego kontrolera przesuwa, prawy obraca skokowo o 30°. */
  private readXrInput() {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    this.xrMove.set(0, 0);
    let turn = 0;
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const ax = gp.axes.length >= 4 ? [gp.axes[2] ?? 0, gp.axes[3] ?? 0] : [gp.axes[0] ?? 0, gp.axes[1] ?? 0];
      const dead = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
      if (src.handedness === 'right') turn = dead(ax[0]);
      else this.xrMove.set(dead(ax[0]), dead(ax[1]));
    }
    // obrót skokowy z histerezą, żeby jedno wychylenie dało jeden obrót
    if (Math.abs(turn) > 0.6 && !this.snapTurnArmed) {
      this.snapTurnArmed = true;
      this.snapTurn(turn);
    } else if (Math.abs(turn) < 0.3) this.snapTurnArmed = false;
  }

  /**
   * Obrót o 30° wokół głowy — płynne obracanie w goglach wywołuje mdłości, więc i kontroler, i pad
   * obracają skokowo. Głowa zostaje w miejscu, obraca się rig, więc ciało fizyki trzeba przestawić.
   */
  private snapTurn(dir: number) {
    const a = Math.sign(dir) * -(Math.PI / 6);
    const head = this.renderer.xr.getCamera().getWorldPosition(tmpV2);
    this.rig.rotation.y += a;
    const dx = this.rig.position.x - head.x;
    const dz = this.rig.position.z - head.z;
    this.rig.position.x = head.x + dx * Math.cos(a) + dz * Math.sin(a);
    this.rig.position.z = head.z - dx * Math.sin(a) + dz * Math.cos(a);
    this.yaw = this.rig.rotation.y;
    this.physics?.teleport(tmpV3.set(this.rig.position.x, this.rig.position.y - this.headOffset, this.rig.position.z));
  }

  // ---------- przejażdżka: samolot i wierzchowce ----------

  /**
   * Gdzie wolno wsiąść. W goglach nie: wysokość głowy podaje headset, więc kamera
   * nie usiadłaby w siodle, tylko stała nad nim. Tryb stereo (telefon w goglach) podaje sam obrót
   * głowy, a pozycję nadal trzyma rig — tam siedzi się dokładnie jak w widoku z oczu.
   */
  private canBoard(): boolean {
    if (this.renderer.xr.isPresenting) return false;
    return this.mode === 'fp' || this.mode === 'vr';
  }

  /**
   * Wierzchowiec w zasięgu wsiadania: liczy się odległość od siodła, bo skrzydło zasłania celownik.
   * Powiększony wierzchowiec ma odpowiednio większy zasięg — inaczej nie dałoby się dosięgnąć siodła.
   */
  private mountInReach(): Entry | null {
    if (!this.canBoard()) return null;
    let best: Entry | null = null;
    let bestD = Infinity;
    for (const e of this.entries.values()) {
      if (!isMount(e.type) || !e.group.visible) continue;
      const seat = this.seatWorld(e, e.type, tmpV);
      const d = Math.hypot(seat.x - this.rig.position.x, seat.z - this.rig.position.z);
      const reach = MOUNT_SPECS[e.type].reach * Math.max(1, hs(e));
      if (d < reach && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Siodło w świecie: z modelu albo z ruchomej części (głowa czerwia unosi jeźdźca, prostując się). */
  private seatWorld(e: Entry, mount: MountId, out: THREE.Vector3): THREE.Vector3 {
    const a = MOUNT_ANCHORS[mount];
    const bone = a.seatBone ? e.parts.get(a.seatBone) : undefined;
    if (bone) {
      // kość ma własne, dowolne osie — przesunięcie siodła liczymy w układzie obiektu, nie kości
      bone.getWorldPosition(out);
      e.group.worldToLocal(out);
      out.x += a.seat[0];
      out.y += a.seat[1];
      out.z += a.seat[2];
      return e.group.localToWorld(out);
    }
    const node = (a.seatPart && e.parts.get(a.seatPart)) || e.group;
    return node.localToWorld(out.set(a.seat[0], a.seat[1], a.seat[2]));
  }

  /** Wysokość gruntu pod punktem: płyta jest płaska, poza nią liczy się ukształtowanie terenu. */
  private groundHeightAt(x: number, z: number): number {
    if (this.walkArea && insideGround(this.walkArea, x, z)) return 0;
    return this.terrain ? this.terrain.heightAt(x, z) : 0;
  }

  /** Zasięg jazdy i lotu: pierścień terenu, a bez krajobrazu okolica planszy. */
  private rideRadius(): number {
    if (this.terrain) return this.terrain.size / 2 - 6;
    return (this.walkArea ? groundExtent(this.walkArea) : 24) * 2;
  }

  private boardMount(id: string) {
    if (this.descent) return;
    this.dropBow();
    const e = this.entries.get(id);
    const o = this.lastPalace?.objects.find((x) => x.id === id);
    if (!e || !o || !isMount(e.type)) return;
    const spec = MOUNT_SPECS[e.type];
    const p = e.group.position;
    this.ride = { id, mount: e.type, state: newRideState(p.x, p.y, p.z, o.rotation[1], spec), trail: [], anim: 0 };
    if (spec.leap) this.resetTrail(e, this.ride);
    // plansza nie zmienia się w trakcie jazdy, więc zacisk maszyny bez pilota powstaje raz
    // maszyna bez pilota zostaje tam, gdzie da się do niej dojść — czyli w granicach chodzenia
    const area = this.walkArea;
    this.rideEnv.clampToBoard = area && !this.terrain ? (x, z) => clampToGround(area, x, z, 0) : (x, z) => this.clampWalk(x, z);
    // bryła kolizji zostałaby na miejscu postoju — na czas jazdy znika, a po zsiadnięciu wraca z nowej pozycji
    this.physics?.removeStatic(id);
    this.yaw = 0;
    this.pitch = -0.1;
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(this.pitch, 0, 0);
    const st = useStore.getState();
    st.setRiding(e.type);
    st.setDoorPrompt(null);
    st.setPlacing(null);
    this.touchSprint = false;
    this.rideHit = null;
    st.showToast(this.padSeen ? spec.labels.toastPad : spec.labels.toastKeys);
    this.applyLighting();
  }

  /** Ślad czerwia na start: prosta linia za głową, żeby ciało od pierwszej klatki miało za czym się ciągnąć. */
  private resetTrail(e: Entry, r: Ride) {
    const s = r.state;
    const step = 1.5 * hs(e);
    r.trail.length = 0;
    for (let i = 26; i >= 1; i--) r.trail.push(s.x + Math.sin(s.yaw) * step * i, s.y, s.z + Math.cos(s.yaw) * step * i);
  }

  /** Przerywa jazdę bez zapisywania pozycji: wierzchowiec zniknął ze sceny (zmiana pałacu, usunięcie obiektu). */
  private cancelRide() {
    if (!this.ride) return;
    const pilot = this.ride.state.pilot;
    this.ride = null;
    useStore.getState().setRiding(null);
    this.applyLighting();
    // rig ma obrót maszyny (z przechyłem) — bez tego spacer zaczynałby się z przekrzywionym horyzontem
    if (pilot) this.placeRig(this.spawnPose());
  }

  private get riding(): boolean {
    return !!this.ride?.state.pilot;
  }

  /**
   * Zsiadanie: wierzchowiec zostaje tam, gdzie stanął (wyrównany, na ziemi), a gracz obok, twarzą do niego.
   * Bez `force` wymaga postoju na planszy — poza nią nie da się chodzić.
   */
  leaveMount(force = false): boolean {
    const r = this.ride;
    if (!r || !r.state.pilot) return false;
    const s = r.state;
    const spec = MOUNT_SPECS[r.mount];
    const st = useStore.getState();
    if (!force) {
      // w powietrzu zsiadanie to skok ze spadochronem; z konia w skoku i czerwia w wyskoku nie da się zejść
      if (!s.onGround) {
        if (spec.kind !== 'ground') return this.bailOut();
        st.showToast('Poczekaj, aż wierzchowiec opadnie na ziemię.');
        return false;
      }
      if (Math.abs(s.speed) > 1.2) {
        st.showToast(spec.kind === 'air' ? 'Najpierw zatrzymaj maszynę.' : 'Najpierw zatrzymaj wierzchowca.');
        return false;
      }
      if (this.walkArea && !insideGround(this.walkArea, s.x, s.z)) {
        st.showToast('Zsiąść można tylko nad planszą — wróć i zatrzymaj się na niej.');
        return false;
      }
    }
    const [mx, mz] = [s.x, s.z];
    const stand = this.parkMount();
    st.setRiding(null);
    st.setDoorPrompt(null);
    this.applyLighting();
    // twarzą do wierzchowca: przód riga to −Z obrócone o yaw
    this.placeRig({ x: stand[0], z: stand[1], yaw: Math.atan2(-(mx - stand[0]), -(mz - stand[1])) });
    return true;
  }

  /**
   * Koniec jazdy: wierzchowiec zostaje tam, gdzie stanął — wyrównany, na ziemi, w pozie spoczynkowej, z kolizją
   * i zapisem w pałacu. Wspólne dla zsiadania i dla maszyny, która po skoku pilota stanęła sama. Zwraca miejsce obok.
   */
  private parkMount(): [number, number] {
    const r = this.ride!;
    const s = r.state;
    const st = useStore.getState();
    const e = this.entries.get(r.id);
    const pos: Vec3 = [s.x, this.groundHeightAt(s.x, s.z), s.z];
    const yaw = s.yaw;
    this.ride = null;
    let stand: [number, number] = [pos[0], pos[2]];
    if (e) {
      this.restRig(e);
      e.group.position.set(pos[0], pos[1], pos[2]);
      e.group.rotation.set(0, yaw, 0);
      e.group.updateMatrixWorld(true);
      const a = MOUNT_ANCHORS[r.mount].exit;
      const out = e.group.localToWorld(tmpV.set(a[0], a[1], a[2]));
      stand = this.clampXZ(out.x, out.z);
      // kolider wraca tutaj, a nie w `syncObjects`: po jeździe w kółko pozycja bywa ta sama, więc klucz
      // przekształcenia się nie zmienia i wpis zostałby bez bryły kolizji
      this.physics?.setStatic(r.id, this.shapeFor(e), e.group.position, e.group.quaternion, e.group.scale);
    }
    const id = r.id;
    st.setPalace((pl) => {
      const o = pl.objects.find((x) => x.id === id);
      if (!o) return;
      o.position = pos;
      o.rotation = [0, yaw, 0];
      delete o.anchorId; // po jeździe wierzchowiec nie stoi już na tym, na czym zaparkował
    });
    return stand;
  }

  /** Poza jazdą ruchome części wracają do pozy z budowy; kłęby ognia i piasku gasną. */
  private restRig(e: Entry) {
    for (const c of e.parts.values()) {
      const rest = c.userData.rest as number[] | undefined;
      if (!rest) continue;
      c.position.set(rest[0], rest[1], rest[2]);
      c.rotation.set(rest[3], rest[4], rest[5]);
    }
    e.model.position.set(0, 0, 0);
    this.setEmitterOpacity(e, 0);
    const assetMount = ASSET_MOUNTS[e.type];
    if (assetMount) this.playClip(e, assetMount.clips.idle, 1);
  }

  private setEmitterOpacity(e: Entry, opacity: number) {
    const m = e.emitter?.object as THREE.InstancedMesh | undefined;
    if (m?.material) (m.material as THREE.MeshStandardMaterial).opacity = opacity;
  }

  // ---------- skok ze spadochronem ----------

  /** Skok z siodła: gracz wypada z pędem maszyny, a ta leci dalej sama. */
  private bailOut(): boolean {
    const r = this.ride;
    const e = r && this.entries.get(r.id);
    if (!r || !e) return false;
    const s = r.state;
    const st = useStore.getState();
    if (s.y - this.groundHeightAt(s.x, s.z) < BAIL_MIN_HEIGHT) {
      st.showToast('Za nisko na skok — nabierz wysokości albo wyląduj.');
      return false;
    }
    if (this.walkArea && !insideGround(this.walkArea, s.x, s.z)) {
      st.showToast('Skoczyć można tylko nad planszą — poza nią nie da się chodzić.');
      return false;
    }
    s.pilot = false;
    const seat = this.seatWorld(e, r.mount, tmpV);
    const horiz = Math.cos(s.pitch) * s.speed;
    this.descent = {
      pos: new THREE.Vector3(seat.x, seat.y - EYE, seat.z),
      vel: new THREE.Vector3(-Math.sin(s.yaw) * horiz, Math.sin(s.pitch) * s.speed, -Math.cos(s.yaw) * horiz),
      chute: false,
      opened: 0,
    };
    // rig prostuje się do kursu maszyny; w siodle kamera siedziała w jego środku, teraz wraca na oczy
    this.yaw = s.yaw;
    this.pitch = -0.35;
    this.rig.position.copy(this.descent.pos);
    this.rig.rotation.set(0, this.yaw, 0);
    if (!this.renderer.xr.isPresenting) {
      this.camera.position.set(0, EYE, 0);
      if (!this.stereo) this.camera.rotation.set(this.pitch, 0, 0);
    }
    st.setRiding(null);
    st.setDescent('fall');
    st.setDoorPrompt(null);
    st.showToast(this.padSeen ? 'Spadasz! ✕ otwiera spadochron.' : 'Spadasz! Spacja otwiera spadochron.');
    return true;
  }

  openChute() {
    const d = this.descent;
    if (!d || d.chute) return;
    d.chute = true;
    d.opened = 0;
    if (!this.chute) {
      this.chute = buildParachute();
      this.rig.add(this.chute);
    }
    this.chute.visible = true;
    this.chute.scale.setScalar(0.05);
    useStore.getState().setDescent('chute');
  }

  private updateDescent(dt: number) {
    const d = this.descent!;
    const k = this.keys;
    let mx = this.joystick.x + this.xrMove.x + this.pad.x;
    let mz = this.joystick.y + this.xrMove.y + this.pad.y;
    if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyQ')) this.look(-1.6 * dt, 0);
    if (k.has('KeyE')) this.look(1.6 * dt, 0);
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    // jak w spacerze: w goglach i stereo kierunek nadaje głowa
    const headDriven = this.stereo || this.renderer.xr.isPresenting;
    const yaw = headDriven
      ? yawOf(this.renderer.xr.isPresenting ? this.renderer.xr.getCamera().getWorldQuaternion(tmpQ) : this.camera.getWorldQuaternion(tmpQ))
      : this.rig.rotation.y;
    const target = tmpV.set(mx, 0, mz).multiplyScalar(d.chute ? CHUTE_DRIFT : FREEFALL_DRIFT).applyAxisAngle(UP, yaw);
    const damp = THREE.MathUtils.damp;
    if (d.chute) {
      d.opened += dt;
      const grip = Math.min(d.opened / CHUTE_OPEN_TIME, 1);
      d.vel.x = damp(d.vel.x, target.x, 1 + 3 * grip, dt);
      d.vel.z = damp(d.vel.z, target.z, 1 + 3 * grip, dt);
      d.vel.y = damp(d.vel.y, -CHUTE_FALL, 1 + 4 * grip, dt);
      if (this.chute) {
        const sm = grip * grip * (3 - 2 * grip);
        this.chute.scale.setScalar(0.05 + 0.95 * sm);
        // czasza pochyla się pod ruch: prędkość w układzie riga
        const ry = this.rig.rotation.y;
        const lx = d.vel.x * Math.cos(ry) - d.vel.z * Math.sin(ry);
        const lz = d.vel.x * Math.sin(ry) + d.vel.z * Math.cos(ry);
        this.chute.rotation.set(lz * 0.04, 0, -lx * 0.04);
      }
    } else {
      d.vel.x = damp(d.vel.x, target.x, 0.5, dt);
      d.vel.z = damp(d.vel.z, target.z, 0.5, dt);
      d.vel.y = Math.max(d.vel.y - 9.8 * dt, -FREEFALL_MAX);
    }
    d.pos.addScaledVector(d.vel, dt);
    // w powietrzu ta sama granica co na ziemi: poza planszą nie da się chodzić, więc nie ma gdzie lądować
    const [cx, cz] = this.clampXZ(d.pos.x, d.pos.z);
    d.pos.x = cx;
    d.pos.z = cz;
    const gy = this.groundHeightAt(cx, cz);
    if (!d.chute && d.pos.y - gy < CHUTE_AUTO) {
      this.openChute();
      useStore.getState().showToast('Spadochron otworzył się sam.');
    }
    if (d.pos.y <= gy) {
      this.land(gy);
      return;
    }
    this.rig.position.copy(d.pos);
  }

  /** Przyziemienie: fizyka odbiera postać tam, gdzie stanęła, czasza znika. */
  private land(gy: number) {
    const d = this.descent!;
    const hard = !d.chute || d.vel.y < -7;
    this.descent = null;
    if (this.chute) this.chute.visible = false;
    const [x, z] = this.clampXZ(d.pos.x, d.pos.z);
    this.rig.position.set(x, gy, z);
    this.physics?.teleport(tmpV3.set(x, gy, z));
    const st = useStore.getState();
    st.setDescent(null);
    this.applyLighting();
    st.showToast(hard ? 'Twarde lądowanie. Na szczęście to tylko pałac pamięci.' : 'Miękkie lądowanie.');
  }

  /** Powrót do edytora w trakcie zeskoku: wejście do świata i tak zaczyna od punktu startu. */
  private abortDescent() {
    if (!this.descent) return;
    this.descent = null;
    if (this.chute) this.chute.visible = false;
    useStore.getState().setDescent(null);
  }

  /** Skokowa zmiana gazu — przyciski na telefonie, Spacja i krzyżak pada. Koń nie ma gazu. */
  throttleStep(d: number) {
    const r = this.ride;
    if (!r?.state.pilot) return;
    const spec = MOUNT_SPECS[r.mount];
    if (spec.kind === 'ground' && !spec.leap) return;
    r.state.throttle = THREE.MathUtils.clamp(r.state.throttle + d, 0, 1);
  }

  private updateRide(dt: number) {
    const r = this.ride;
    if (!r) return;
    const e = this.entries.get(r.id);
    if (!e) {
      this.cancelRide();
      return;
    }
    const s = r.state;
    const spec = MOUNT_SPECS[r.mount];
    const k = this.keys;
    const clamp = THREE.MathUtils.clamp;
    const key = (...codes: string[]) => (codes.some((c) => k.has(c)) ? 1 : 0);
    const shift = key('ShiftLeft', 'ShiftRight');
    const ctrl = key('ControlLeft', 'ControlRight');
    const w = key('KeyW', 'ArrowUp');
    const sKey = key('KeyS', 'ArrowDown');
    const aKey = key('KeyA', 'ArrowLeft');
    const dKey = key('KeyD', 'ArrowRight');
    const q = key('KeyQ');
    const eKey = key('KeyE');
    const inp = this.rideInput;
    if (spec.kind === 'ground' && !spec.leap) {
      // koń: W/S to naprzód i wstecz, gałki jak w spacerze (do przodu to ujemne Y), skręt jak przechył w locie
      inp.throttle = clamp(w - sKey - this.joystick.y - this.pad.y, -1, 1);
      inp.turn = clamp(dKey - aKey + eKey - q + this.joystick.x + this.pad.x + this.padYaw, -1, 1);
      inp.sprint = shift > 0 || this.padSprint || this.touchSprint;
      inp.pitch = 0;
      inp.roll = 0;
      inp.yaw = 0;
    } else {
      inp.throttle = clamp(shift - ctrl + this.padThrottle, -1, 1);
      // śmigłowiec: W/S to lot do przodu i do tyłu (gałki jak w spacerze, do przodu to ujemne Y)
      inp.pitch = spec.kind === 'hover' ? clamp(w - sKey - this.joystick.y - this.pad.y, -1, 1) : clamp(sKey - w + this.joystick.y + this.pad.y, -1, 1);
      inp.roll = clamp(dKey - aKey + this.joystick.x + this.pad.x, -1, 1);
      inp.yaw = clamp(eKey - q + this.padYaw, -1, 1);
      inp.turn = spec.leap ? clamp(inp.roll + inp.yaw, -1, 1) : 0; // czerw: A/D i Q/E skręcają
      inp.sprint = false;
    }
    this.rideEnv.radius = this.rideRadius();
    this.rideEnv.scale = hs(e);
    stepRide(s, inp, spec, this.rideEnv, dt);
    // skok i ogień to zdarzenia — zużyte w tym kroku
    inp.jump = false;
    inp.fire = false;

    // zderzenie z budynkiem albo drzewem: maszyna nie staje, tylko układa się wzdłuż ściany i sunie dalej
    const bump = pushOut(s.x, s.z, this.obstacles(), e.footprint * 0.4 * hs(e), s.y, e.id);
    if (bump.hit) {
      s.x = bump.x;
      s.z = bump.z;
      // po wypchnięciu punkt leży dokładnie na marginesie, więc normalna z `contact` wskazuje ścianę, o którą się otarł
      const c = contact(bump.hit, s.x, s.z, s.y);
      const into = resolveBump(s, c.nx, c.nz, spec, dt);
      const now = performance.now();
      if (into > 0.6 && s.pilot && now - this.rideHitAt > 4000) {
        this.rideHitAt = now;
        useStore.getState().showToast(spec.kind === 'ground' ? 'Ocierasz się o przeszkodę.' : 'Otarcie — maszyna ślizga się wzdłuż przeszkody.');
      }
      this.rideHit = bump.hit.id;
    } else this.rideHit = null;

    // maszyna bez pilota: po wytoczeniu staje i wraca do pałacu jako zwykły obiekt
    if (rideSettled(s)) {
      this.parkMount();
      return;
    }

    e.group.position.set(s.x, s.y, s.z);
    e.group.quaternion.setFromEuler(flightEuler.set(s.pitch, s.yaw, s.roll));
    e.group.updateMatrixWorld(true);
    this.animateMount(e, r, spec, dt);

    // kamera siedzi w siodle: rig przejmuje obrót maszyny, rozglądanie zostaje w kamerze
    if (s.pilot) {
      this.rig.position.copy(this.seatWorld(e, r.mount, tmpV));
      // koń podskakuje tułowiem, ale jeździec nie ma kiwać horyzontem — rig bierze sam obrót w poziomie
      if (spec.kind === 'ground' && !spec.leap) this.rig.quaternion.setFromEuler(flightEuler.set(0, s.yaw, 0));
      else this.rig.quaternion.copy(e.group.quaternion);
    }
  }

  /** Ruchome części wierzchowca w jeździe: śmigło, skrzydła i ogon smoka, nogi konia, segmenty i paszcza czerwia. */
  private animateMount(e: Entry, r: Ride, spec: MountSpec, dt: number) {
    const s = r.state;
    const parts = e.parts;
    const damp = THREE.MathUtils.damp;
    const assetMount = ASSET_MOUNTS[r.mount];
    if (assetMount && e.anim) {
      // model z pliku: klipy zamiast pivotów — tempo klipu idzie za prędkością
      const c = assetMount.clips;
      const v = Math.abs(s.speed);
      if (spec.kind === 'hover') {
        this.playClip(e, !s.onGround && v > 6 ? c.run : c.idle, s.onGround ? 0.6 : 1);
        this.setEmitterOpacity(e, s.fire > 0 ? 0.75 : 0);
      } else if (!s.onGround) this.playClip(e, c.jump ?? c.run, 1);
      else if (v < 0.3) this.playClip(e, c.idle, 1);
      else if (c.walk && v < 5) this.playClip(e, c.walk, Math.max(0.5, v / 3.5));
      else this.playClip(e, c.run, THREE.MathUtils.clamp(v / spec.maxSpeed * 1.2, 0.6, 1.4));
      return;
    }
    const prop = parts.get('propeller');
    if (prop) prop.rotation.z = (prop.rotation.z + (1.5 + s.speed * 1.6) * dt) % (Math.PI * 2);

    if (spec.kind === 'hover') {
      // smok: na ziemi skrzydła wracają do złożonych, w powietrzu machają tym szybciej, im szybciej się wznosi
      r.anim += dt * (5 + Math.max(0, s.vy) * 0.8);
      const flap = Math.sin(r.anim) * 0.5;
      for (const [name, sign] of [['wingL', -1], ['wingR', 1]] as [string, number][]) {
        const wing = parts.get(name);
        if (!wing) continue;
        const rest = (wing.userData.rest as number[])[5];
        wing.rotation.z = damp(wing.rotation.z, s.onGround ? rest : sign * flap, s.onGround ? 3 : 8, dt);
      }
      const tail = parts.get('tail');
      if (tail) {
        tail.rotation.y = Math.sin(r.anim * 0.45) * 0.18;
        tail.rotation.x = Math.sin(r.anim * 0.3) * 0.08;
      }
      for (const name of ['legFL', 'legFR', 'legBL', 'legBR']) {
        const leg = parts.get(name);
        if (leg) leg.rotation.x = damp(leg.rotation.x, s.onGround ? 0 : -0.9, 5, dt); // w locie nogi podkulone
      }
      this.setEmitterOpacity(e, s.fire > 0 ? 0.75 : 0);
      return;
    }

    if (spec.leap) {
      this.animateWorm(e, r, spec, dt);
      return;
    }

    if (spec.kind === 'ground') {
      // koń: kłus po przekątnej — faza rośnie z drogą, więc na postoju nogi stoją
      r.anim += dt * 3;
      const amp = Math.min(Math.abs(s.speed) / 4, 1) * 0.55;
      const sw = Math.sin(s.phase * 2.8);
      const pairs: [string, number][] = [['legFL', 1], ['legBR', 1], ['legFR', -1], ['legBL', -1]];
      for (const [name, sign] of pairs) {
        const leg = parts.get(name);
        if (!leg) continue;
        leg.rotation.x = s.onGround ? sw * amp * sign : damp(leg.rotation.x, -0.5, 6, dt);
      }
      const head = parts.get('head');
      if (head) head.rotation.x = (head.userData.rest as number[])[3] + Math.sin(s.phase * 2.8) * 0.06 * amp;
      const tail = parts.get('tail');
      if (tail) tail.rotation.y = Math.sin(r.anim) * 0.2;
      e.model.position.y = s.onGround ? Math.abs(sw) * 0.1 * amp : 0;
    }
  }

  /**
   * Czerw: głowa prostuje się z pozy spoczynkowej, segmenty ciągną się śladem głowy (pod ziemią, gdy próbki
   * pochodzą sprzed wyskoku), paszcza rozchyla się w pierwszej połowie skoku, a piasek kłębi się z prędkością.
   */
  private animateWorm(e: Entry, r: Ride, spec: MountSpec, dt: number) {
    const s = r.state;
    const parts = e.parts;
    const damp = THREE.MathUtils.damp;
    const head = parts.get('head');
    if (head) head.rotation.x = damp(head.rotation.x, 0, 4, dt);
    const scale = hs(e);
    advanceTrail(r.trail, s.x, s.y, s.z, 1.5 * scale, 26);
    const seg = 3 * scale;
    for (let i = 0; ; i++) {
      const part = parts.get(`seg${i}`);
      if (!part) break;
      const ahead = trailPoint(r.trail, s.x, s.y, s.z, i * seg + 1.5 * scale);
      const center = trailPoint(r.trail, s.x, s.y, s.z, (i + 1) * seg + 1.5 * scale);
      part.position.copy(e.group.worldToLocal(tmpV.set(center[0], center[1], center[2])));
      part.position.y += (part.userData.radius as number | undefined) ?? 0;
      // segment patrzy w stronę poprzednika: +Z lokalne w stronę głowy, więc szerszy koniec z przodu
      part.lookAt(tmpV2.set(ahead[0], ahead[1] + ((part.userData.radius as number | undefined) ?? 0) * e.group.scale.y, ahead[2]));
    }
    const leaping = s.leapT >= 0 && spec.leap && s.leapT < spec.leap.duration * 0.5;
    for (const name of ['jawL', 'jawR', 'jawT', 'jawB']) {
      const jaw = parts.get(name);
      if (!jaw) continue;
      const rest = (jaw.userData.rest as number[])[3];
      const sign = rest < 0 ? -1 : 1;
      jaw.rotation.x = damp(jaw.rotation.x, leaping ? sign * 0.9 : rest, 5, dt);
    }
    const burst = spec.leap && s.leapT < 0 && s.onGround && s.pitch < -0.2 ? 0.9 : 0;
    this.setEmitterOpacity(e, s.onGround ? Math.max(Math.min(Math.abs(s.speed) / 8, 1) * 0.5, burst) : 0);
  }

  // ---------- łuk ----------
  /**
   * Bierze łuk do ręki albo go odkłada. Prototyp sięga po niego klawiszem B; docelowo łuk stoi
   * na stojaku i podnosi się go tak, jak dosiada wierzchowca (etap 2 planu strzelnicy).
   */
  toggleBow() {
    if (this.archery) {
      this.dropBow();
      return;
    }
    if (this.mode !== 'fp' || this.riding || this.descent || this.stereo || this.renderer.xr.isPresenting) return;
    const a = new Archery();
    this.archery = a;
    this.scene.add(a.object);
    this.camera.add(a.hand);
    // łuk zajmuje lewy przycisk, więc stawianie obiektu i strzelanie wykluczają się
    useStore.getState().setPlacing(null);
    useStore.getState().setBow(true);
    useStore.getState().showToast('Trzymaj lewy przycisk — naciąg, puść — strzał. B odkłada łuk.');
  }

  /** Odkłada łuk: strzały znikają razem z nim, kamera wraca do zwykłego kąta widzenia. */
  private dropBow() {
    const a = this.archery;
    if (!a) return;
    this.archery = null;
    a.dispose();
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.container.style.removeProperty('--draw');
    this.lastDraw = -1;
    useStore.getState().setBow(false);
  }

  /**
   * Krok łucznictwa: naciąg prowadzi moduł, a scena dokłada to, co należy do kamery — przybliżenie
   * i drżenie ręki. Obrót kamery ustawia `look`, więc drżenie musi wejść tutaj, już po nim.
   */
  private updateArchery(dt: number) {
    const a = this.archery;
    if (!a) return;
    a.update(dt, this.camera, this.castArrow, this.entryMatrix);
    const fov = 70 - 8 * a.draw;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (!this.riding) this.camera.rotation.set(this.pitch + a.swayXY[1], a.swayXY[0], 0);
    // celownik czyta naciąg ze zmiennej CSS; zapis co klatkę unieważniałby style bez potrzeby
    const draw = Math.round(a.draw * 50) / 50;
    if (draw !== this.lastDraw) {
      this.lastDraw = draw;
      this.container.style.setProperty('--draw', String(draw));
    }
  }

  /**
   * Trafienie strzały: promień po siatkach modeli, a nie po bryłach fizyki — strzała ma zostać tam,
   * gdzie widać trafienie (w pniu drzewa, nie w niewidzialnym pudle wokół niego).
   */
  private castArrow = (from: THREE.Vector3, dir: THREE.Vector3, dist: number): ArrowHit | null => {
    this.raycaster.set(from, dir);
    this.raycaster.far = dist;
    const targets: THREE.Object3D[] = [];
    for (const e of this.entries.values()) {
      // ścieżki, okna i markery zwierząt nie mają bryły także dla strzał — przelatuje przez nie
      if (e.group.visible && colliderKind(e.type) !== 'none') targets.push(e.group);
    }
    if (this.room) targets.push(this.room.group);
    if (this.ground) targets.push(this.ground);
    if (this.terrain) targets.push(this.terrain.group);
    const hits = this.raycaster.intersectObjects(targets, true);
    this.raycaster.far = Infinity;
    for (const h of hits) {
      if (!isShown(h.object) || h.object.userData.noPick) continue;
      return { point: h.point.clone(), objectId: (h.object.userData.objectId as string | undefined) ?? null };
    }
    return null;
  };

  /** Macierz wpisu, w którym siedzi wbita strzała — po niej strzała jedzie z obiektem. */
  private entryMatrix = (objectId: string): THREE.Matrix4 | null => {
    const e = this.entries.get(objectId);
    if (!e) return null;
    e.group.updateWorldMatrix(true, false);
    return e.group.matrixWorld;
  };

  private updateFp(dt: number) {
    const k = this.keys;
    let mx = this.joystick.x + this.xrMove.x + this.pad.x;
    let mz = this.joystick.y + this.xrMove.y + this.pad.y;
    // Cardboard: idziemy tam, gdzie patrzymy, ale dopiero po chwili przytrzymania —
    // inaczej samo rozglądanie albo krótkie dotknięcie przesuwałoby gracza
    if (this.touchHold && performance.now() - this.touchStart > 180) mz -= 1;
    if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyQ')) this.look(-1.6 * dt, 0);
    if (k.has('KeyE')) this.look(1.6 * dt, 0);
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') || this.padSprint ? 6.5 : 3.6;
    const target = tmpV.set(mx, 0, mz).multiplyScalar(speed);
    // kierunek względem obrotu rigu (VR: względem głowy)
    // w goglach i w trybie stereo idziemy tam, gdzie patrzy głowa
    const headDriven = this.stereo || this.renderer.xr.isPresenting;
    const yaw = headDriven
      ? yawOf(this.renderer.xr.isPresenting ? this.renderer.xr.getCamera().getWorldQuaternion(tmpQ) : this.camera.getWorldQuaternion(tmpQ))
      : this.rig.rotation.y;
    target.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.fpVel.lerp(target, 1 - Math.exp(-dt * 12));

    if (this.physics?.hasCharacter) {
      const jump = this.jumpBuffer > 0;
      if (jump) this.jumpBuffer = 0;
      const step = Math.min(dt, 0.033); // krótszy krok: cienkie deski nie są przenikane przy biegu
      const r = this.physics.stepCharacter(this.fpVel, step, jump);
      const [cx, cz] = this.clampWalk(r.pos.x, r.pos.z);
      // granica świata jest poza fizyką — po przycięciu trzeba przestawić też ciało
      if (Math.abs(cx - r.pos.x) > 1e-4 || Math.abs(cz - r.pos.z) > 1e-4) this.physics.teleport(tmpV3.set(cx, r.pos.y, cz));
      this.rig.position.set(cx, r.pos.y + this.headOffset, cz);
      return;
    }

    // rezerwowe kolizje kołowe, dopóki fizyka się nie wczyta
    if (this.fpVel.lengthSq() < 1e-6) return;
    const [nx, nz] = this.clampWalk(this.rig.position.x + this.fpVel.x * dt, this.rig.position.z + this.fpVel.z * dt);
    const [px, pz] = this.resolveCollisions(nx, nz);
    const [fx, fz] = this.clampWalk(px, pz);
    this.rig.position.x = fx;
    this.rig.position.z = fz;
  }

  /** Skok — także z przycisku na telefonie. */
  jump() {
    if (this.descent) {
      this.openChute();
      return;
    }
    if (this.riding) {
      const spec = MOUNT_SPECS[this.ride!.mount];
      if (spec.kind === 'hover') this.rideInput.fire = true; // smok zionie
      else if (spec.kind === 'air') this.throttleStep(0.25);
      else this.rideInput.jump = true; // koń skacze, czerw wyskakuje z piasku
      return;
    }
    this.jumpBuffer = 0.15;
  }

  /** Wypycha punkt (x,z) poza obrysy obiektów. */
  private resolveCollisions(x: number, z: number, ignoreId?: string, margin = 0.35): [number, number] {
    let px = x;
    let pz = z;
    for (let iter = 0; iter < 3; iter++) {
      for (const e of this.entries.values()) {
        if (e.id === ignoreId || e.inplace) continue; // do budynku z wnętrzem w miejscu się wchodzi
        // ścieżki i zwierzęta nie mają bryły także w fizyce; ścieżka ma skalę X równą długości, więc jej
        // „koło” objęłoby pół planszy
        if (colliderKind(e.type) === 'none') continue;
        const r = e.footprint * 0.75 * hs(e) + margin;
        const dx = px - e.group.position.x;
        const dz = pz - e.group.position.z;
        let d = Math.hypot(dx, dz);
        if (d < r) {
          if (d < 1e-4) {
            px = e.group.position.x + r;
            continue;
          }
          px = e.group.position.x + (dx / d) * r;
          pz = e.group.position.z + (dz / d) * r;
        }
      }
    }
    return [px, pz];
  }

  private applyDeviceOrientation() {
    const { alpha, beta, gamma, orient } = this.deviceOrient;
    const zee = new THREE.Vector3(0, 0, 1);
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    tmpE.set(beta, alpha, -gamma, 'YXZ');
    this.camera.quaternion.setFromEuler(tmpE);
    this.camera.quaternion.multiply(q1);
    this.camera.quaternion.multiply(tmpQ.setFromAxisAngle(zee, -orient));
  }

  /**
   * Preset jakości w scenie. Mnożnik pikseli i mapa cienia to dwie rzeczy, które na telefonie
   * decydują o płynności; zmiana rodzaju cienia wymaga przekompilowania materiałów.
   */
  private applyQuality() {
    const q = this.qspec;
    const cap = Math.min(window.devicePixelRatio, q.pixelRatio);
    this.renderer.setPixelRatio(cap * this.renderScale);
    const type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const recompile = this.renderer.shadowMap.enabled !== q.shadowMap > 0 || this.renderer.shadowMap.type !== type;
    this.renderer.shadowMap.enabled = q.shadowMap > 0;
    this.renderer.shadowMap.type = type;
    if (this.sun && q.shadowMap > 0 && this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (recompile && this.scene) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) for (const one of m) one.needsUpdate = true;
        else if (m) m.needsUpdate = true;
      });
    }
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.qspec = qualitySpec(q, deviceEnv());
    this.renderScale = 1;
    this.scaleHold = 120;
    this.buildLightPool();
    this.applyQuality();
    this.resize();
  }

  getQuality(): Quality {
    return this.quality;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.renderer.xr.isPresenting) {
      if (this.stereo) this.stereo.setSize(w, h);
      else this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
    }
    this.labelRenderer.setSize(w, h);
  }

  dispose() {
    this.disposed = true;
    this.dropBow();
    if (active === this) active = null;
    this.unsub();
    this.renderer.setAnimationLoop(null);
    this.exitVR();
    this.ro.disconnect();
    this.container.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.container.removeEventListener('contextmenu', this.onContextMenu);
    this.container.removeEventListener('wheel', this.onWheel, { capture: true } as EventListenerOptions);
    this.setGhost(null);
    this.clearBrushPreview();
    this.marquee?.el?.remove();
    this.marquee = null;
    for (const ring of this.selRings) this.scene.remove(ring);
    if (this.chute) {
      this.rig.remove(this.chute);
      disposeObject(this.chute);
      this.chute = null;
    }
    this.scene.remove(this.pivot);
    for (const l of this.lightPool) this.scene.remove(l);
    this.lightPool.length = 0;
    for (const e of [...this.entries.values()]) this.removeEntry(e);
    this.weather.dispose();
    this.wildlife.dispose();
    this.sounds.dispose();
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
      this.terrain = null;
    }
    if (this.room) {
      this.scene.remove(this.room.group);
      this.room.dispose();
      this.room = null;
    }
    this.physics?.dispose();
    this.physics = null;
    // TransformControls.dispose() w three 0.169 woła this.traverse(), którego ta klasa nie ma —
    // odłączamy zdarzenia i sprzątamy geometrie uchwytów samodzielnie
    for (const g of [this.gizmo, this.rotateGizmo]) {
      g.detach();
      g.disconnect();
      const helper = g.getHelper();
      helper.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      this.scene.remove(helper);
    }
    this.orbit.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}

/** Blat płyty z listy prostokątów: dwa trójkąty na prostokąt, UV we współrzędnych świata (jak `ShapeGeometry`). */
function rectsGeometry(rects: { x0: number; x1: number; z0: number; z1: number }[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const r of rects) {
    // druga współrzędna z odwrotnym znakiem: obrót o −90° wokół X odwzorowuje ją na świat jako −y,
    // więc dopiero tak blat trafia tam, gdzie leżą kolidery, siatka i bok płyty
    const quad: [number, number][] = [[r.x0, -r.z0], [r.x1, -r.z0], [r.x1, -r.z1], [r.x0, -r.z1]];
    for (const k of [0, 2, 1, 0, 3, 2]) {
      pos.push(quad[k][0], quad[k][1], 0);
      uv.push(quad[k][0], quad[k][1]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** Bok płyty: pionowy pas pod każdą krawędzią obrysu, od poziomu zero w dół. */
function skirtGeometry(rings: [number, number][][], depth: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const ring of rings) {
    // pierścień zaczyna się i kończy w tym samym punkcie, więc każda para sąsiadów to prawdziwa krawędź
    for (let i = 0; i + 1 < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[i + 1];
      pos.push(ax, 0, az, bx, 0, bz, bx, -depth, bz);
      pos.push(ax, 0, az, bx, -depth, bz, ax, -depth, az);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Bok płyty o obrysie wypukłym — jak dotąd, przez wyciągnięcie kształtu w dół. */
function rotatedExtrude(poly: [number, number][], holes: [number, number][][], depth: number): THREE.BufferGeometry {
  const shape = shapeWithHoles(poly, holes);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); // wyciągnięcie idzie wzdłuż +Z, po obrocie schodzi w dół
  return geo;
}

/**
 * Obrys planszy z dziurami (piwnice) jako kształt do triangulacji i wyciągnięcia. `flipZ` odwraca drugą
 * współrzędną dla geometrii, którą obracamy o −90° wokół X (blat) — bez tego dziura wypadłaby po przeciwnej
 * stronie planszy. Kierunek obiegu dziury prostujemy sami: `ShapeGeometry` robi to za nas, ale
 * `ExtrudeGeometry` tylko wtedy, gdy obrys zewnętrzny nie jest zgodny z zegarem — a to zależy od `groundPolygon`.
 */
function shapeWithHoles(poly: [number, number][], holes: [number, number][][], flipZ = false): THREE.Shape {
  const f = flipZ ? -1 : 1;
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, f * z)));
  for (const h of holes) {
    const pts = h.map(([x, z]) => new THREE.Vector2(x, f * z));
    const path = new THREE.Path(signedArea(pts) > 0 ? [...pts].reverse() : pts);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

/** Podwojone pole ze wzoru na sznurowadło — znak mówi, w którą stronę obiegany jest wielokąt. */
function signedArea(pts: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

/**
 * Otwór przycięty do planszy: poza jej obrysem nie ma czego wycinać, a dziura wystająca poza kontur
 * zostawia klin płyty wiszący nad terenem. Plansza z kafli bywa wklęsła, więc tniemy po jej prostokątach.
 */
function clipToGround(ring: [number, number][], g: GroundSpec): [number, number][][] {
  const parts = isDrawnGround(g)
    ? groundRects(g).map((r) => clipPolygon(ring, rectPolygon(r)))
    : [clipPolygon(ring, groundPolygon(g))];
  return parts.filter((p) => p.length >= 3);
}

/** Wielokąt domknięty powtórzonym punktem — `skirtGeometry` rysuje ściankę pod każdą parą sąsiadów. */
function closed(ring: [number, number][]): [number, number][] {
  return [...ring, ring[0]];
}
