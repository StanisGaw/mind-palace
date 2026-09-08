import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import { useStore, descendants, movableRoots, selectionRoots } from '../store';
import { yawOfObject } from '../lib/transform';
import type { CameraKind, Palace, PalaceObject, RoomSpec, Vec3, ViewMode } from '../types';
import { AMBIENCES, catalogItem, hasInterior } from '../catalog';
import { buildModel, disposeObject, modelHeight, shellLeafLocal, DOOR_LEAF_LOCAL, EMITTER_ANCHORS, DOORS, GATE_SPAWN, type BuildCtx } from './builders';
import { ART_VARIANTS } from './art';
import { hashString } from './noise';
import { makeTextPanel, disposeTextPanel } from './text';
import { WeatherSystem } from './weather';
import { PuffEmitter, SwarmEmitter, type Updatable } from './particles';
import { buildTerrain, type Terrain } from './terrain';
import { buildRoom, type Room } from './interior';
import { Physics, FOOT_OFFSET, type StaticShape } from './physics';
import { ROOMS, colliderKind, spawnKind } from '../catalog';
import { clampToGround, clipSegment, groundExtent, groundPolygon, insideGround } from '../lib/ground';
import { DOOR_SLOT, WALL_SEGMENT, WALL_THICKNESS, buildingFloorHeight, buildingFloorY, buildingOf, buildingOpenings, facadeFloorOk, facadeHoles, facadeSlotFree, facadeSnap, isDrawn, isFacade, doorOffsets, doorRange, doorSlotFree, floorOf, floorOfIn, isInPlace, roomSpecFor, stairOpenings, wallLength, wallOffsetOf, wallPointAt, type Opening } from '../lib/rooms';
import { getTexture } from './textures';
import { Wildlife, type SpawnInfo, type WorldInfo } from './wildlife';
import { Soundscape } from './soundscape';
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
  /** Budynek z wnętrzem w tej samej scenie: dach do schowania, stropy pięter i ściany do chowania od strony kamery. */
  inplace: boolean;
  roof: THREE.Object3D | null;
  slabs: THREE.Object3D[];
  walls: THREE.Mesh[];
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
const TOP_VIEW_FOV = 18; // wąski kąt = obraz niemal ortograficzny
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpNdc = new THREE.Vector2();
const tmpE = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
// yawOf ma własny wektor — wołający trzymają w tmpV wektor ruchu, który nie może zostać nadpisany
const tmpYaw = new THREE.Vector3();

/** Klucz trybu stawiania: typ z biblioteki albo szablon kopii konkretnych obiektów. */
function placingKey(p: { type: string; ids?: string[] } | null | undefined): string {
  return p ? `${p.type}|${(p.ids ?? []).join(',')}` : '';
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
  /** Dotyk: po postawieniu zostań w trybie stawiania (odpowiednik Shift). */
  stickyPlacing = false;
  private yaw = 0;
  private pitch = 0;
  private touchLook: { id: number; x: number; y: number; moved: boolean } | null = null;
  private fpVel = new THREE.Vector3();
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.xr.enabled = true;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'labels-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
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
      g.addEventListener('mouseDown', () => this.onGizmoMouseDown());
      g.addEventListener('mouseUp', () => {
        this.multiStart = null;
        this.snapAnchorUnder();
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
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

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
  private buildGround(spec: GroundSpec) {
    if (this.ground) {
      this.scene.remove(this.ground, this.slab, this.grid);
      this.ground.geometry.dispose();
      this.slab.geometry.dispose();
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    const size = groundExtent(spec);
    const poly = groundPolygon(spec);
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
    const amb = AMBIENCES.find((a) => a.id === (this.lastPalace?.settings.ambience ?? 'garden')) ?? AMBIENCES[0];

    const topGeo = new THREE.ShapeGeometry(shape);
    topGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ color: amb.ground, roughness: 1 }));
    this.ground.receiveShadow = true;
    this.ground.userData.ground = true;
    this.scene.add(this.ground);

    const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
    slabGeo.rotateX(Math.PI / 2); // wyciągnięcie idzie wzdłuż +Z, po obrocie schodzi w dół
    this.slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: '#b7bba9', roughness: 1, side: THREE.DoubleSide }));
    this.slab.position.y = -0.01;
    this.slab.receiveShadow = true;
    this.scene.add(this.slab);

    // siatka rysowana liniami przyciętymi do obrysu planszy
    const pts: number[] = [];
    const half = Math.ceil(size / 2) + 1;
    for (let i = -half; i <= half; i++) {
      for (const seg of [
        clipSegment([i, -half - 1], [i, half + 1], poly),
        clipSegment([-half - 1, i], [half + 1, i], poly),
      ]) {
        if (!seg) continue;
        pts.push(seg[0][0], 0, seg[0][1], seg[1][0], 0, seg[1][1]);
      }
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: '#9aa391', transparent: true, opacity: 0.45 }));
    this.grid.position.y = 0.012;
    this.scene.add(this.grid);

    const shadowHalf = size / 2 + 2;
    this.sun.shadow.camera.left = -shadowHalf;
    this.sun.shadow.camera.right = shadowHalf;
    this.sun.shadow.camera.top = shadowHalf;
    this.sun.shadow.camera.bottom = -shadowHalf;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.camera.updateProjectionMatrix();
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

  private rebuildTerrain(p: Palace) {
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
      this.terrain = null;
    }
    this.terrain = buildTerrain(p.settings.ground, p.settings.scenery, p.settings.seed);
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
    const fog = this.weather.fog ?? this.ambienceFog;
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
    if (first) this.cameraCommand('fit', true);
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
    const groundKey = `${p.settings.ground.shape}|${p.settings.ground.width}|${p.settings.ground.depth}`;
    if (this.lastGroundKey !== groundKey) {
      this.buildGround(p.settings.ground);
      this.lastGroundKey = groundKey;
      this.lastTextureKey = '';
    }
    const terrainKey = `${p.settings.scenery}|${p.settings.seed}|${groundKey}`;
    if (terrainKey !== this.terrainKey) {
      this.terrainKey = terrainKey;
      this.rebuildTerrain(p);
    }
    if (this.terrain) this.terrain.group.visible = true;
    const envKey = `out|${p.settings.ambience}|${p.settings.weather}|${groundKey}`;
    if (envKey !== this.envKey) {
      this.envKey = envKey;
      this.weather.apply(p.settings.weather, p.settings.ambience, groundExtent(p.settings.ground), true);
      this.weather.setCloudsVisible(!this.topView);
      this.applyAmbience(p.settings.ambience);
      this.sounds.setEnvironment(p.settings.ambience === 'night', false);
    }
    this.grid.visible = p.settings.grid;
    const texKey = `out|${p.settings.groundTexture ?? ''}|${groundKey}|${p.settings.ambience}`;
    if (texKey !== this.lastTextureKey) {
      this.lastTextureKey = texKey;
      this.applyGroundTexture(p);
    }
    this.walkArea = p.settings.ground;
    const h = groundExtent(p.settings.ground) / 2 - 0.4;
    this.bounds = { hx: p.settings.ground.width / 2 - 0.4, hz: p.settings.ground.depth / 2 - 0.4 };
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
        const group = new THREE.Group();
        group.add(model);
        group.userData.objectId = o.id;
        group.traverse((c) => (c.userData.objectId = o.id));
        this.scene.add(group);
        const item = catalogItem(o.type);
        e = { id: o.id, type: o.type, group, model, height: modelHeight(model), footprint: item.footprint, label: null, labelEl: null, labelKey: '', panel: null, panelKey: '', transformKey: '', emitter: null, buildKey: key, inplace: isInPlace(o), roof: null, slabs: [], walls: [] };
        // drzwi z Konstrukcji i budynki z wnętrzem w miejscu mają otwierane skrzydło; zagnieżdżone budynki nie (F wchodzi do środka)
        if (o.type === 'door' || e.inplace) model.traverse((c) => { if (c.userData.doorLeaf) e!.doorPivot = c as THREE.Group; });
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
    if (isInPlace(o)) return { ...base, floors: o.floors ?? 1, scaleY: Math.round(o.scale[1] * 100) / 100, slabOpenings: buildingOpenings(o, p.objects), facade: facadeHoles(o, p.objects), finish: o.finish };
    if (o.type === 'pathway') return { ...base, scaleX: o.scale[0], scaleZ: o.scale[2], finish: o.finish };
    // taras: schodki od podłogi parteru do ziemi
    if (o.type === 'terrace' && b) return { ...base, drop: Math.round((buildingFloorY(b, 0) - b.position[1]) * 100) / 100 };
    if (o.type === 'painting') return { ...base, variant: hashString(o.id) % ART_VARIANTS };
    // regał i stos książek: układ tomów z ziarna obiektu
    if (o.type === 'shelf' || o.type === 'books') return { ...base, variant: hashString(o.id) % 1000 };
    return base;
  }

  private removeEntry(e: Entry) {
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
    Physics.load()
      .then((p) => {
        this.physicsLoading = false;
        if (this.disposed) {
          p.dispose();
          return;
        }
        this.physics = p;
        this.rebuildPhysics();
      })
      .catch((err) => {
        this.physicsLoading = false;
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
      ph.setGroundShape(groundPolygon(p.settings.ground), 0.6);
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
  private setGhost(placing: { type: string; ids?: string[] } | null) {
    const key = placingKey(placing);
    if (this.ghostKey === key) return;
    this.ghostKey = key;
    const type = placing?.type ?? null;
    this.ghostType = type ?? '';
    this.ghostIds = placing?.ids ?? null;
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
    const sources = this.ghostIds && p ? p.objects.filter((o) => this.ghostIds!.includes(o.id)) : [];
    if (sources.length > 0 && p) {
      // szablon kopii: modele oryginałów w ich wzajemnym układzie, środek pod kursorem
      const roots = sources.filter((o) => !o.anchorId || !this.ghostIds!.includes(o.anchorId));
      const cx = roots.reduce((a, o) => a + o.position[0], 0) / roots.length;
      const cz = roots.reduce((a, o) => a + o.position[2], 0) / roots.length;
      const baseY = Math.min(...roots.map((o) => o.position[1]));
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
        const reach = Math.hypot(wrap.position.x, wrap.position.z) + (e ? e.footprint * hs(e) : 1);
        this.ghostFootprint = Math.max(this.ghostFootprint, reach);
      }
    } else {
      const active = this.activeBuilding();
      g.add(buildModel(type, { floorHeight: active ? buildingFloorHeight(active) : floorHeightFor(p) }));
      this.ghostFootprint = catalogItem(type).footprint;
    }
    g.traverse((c) => {
      const light = c as THREE.PointLight;
      if (light.isPointLight) light.intensity = 0;
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
    const active = this.activeBuilding();
    // przy aktywnym budynku liczą się jego ścianki na edytowanym piętrze; wolno stojące ścianki planszy zawsze
    const free = p.objects.filter((o) => o.type === 'wall' && !buildingOf(p.objects, o) && floorOf(o.position[1], H) === (active ? 0 : editFloor));
    if (!active) return free;
    return [...p.objects.filter((o) => o.type === 'wall' && buildingOf(p.objects, o)?.id === active.id && floorOfIn(active, o.position[1]) === editFloor), ...free];
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
      // ścieżka: bez kotwicy i scalania, za to cały ciąg w jednej grupie (od drugiego odcinka)
      const id = st.addObject('pathway', [this.ghostPos.x, 0, this.ghostPos.z], this.ghostRot, undefined, [this.wallLen / WALL_SEGMENT, 1, 1]);
      if (this.lastWallId) {
        this.drawGroupId ??= uid('g');
        const gid = this.drawGroupId;
        st.updateObjects([{ id: this.lastWallId, patch: { groupId: gid } }, { id, patch: { groupId: gid } }], { undo: false });
      }
      this.lastWallId = id;
    } else {
      const id = st.addObject('wall', [this.ghostPos.x, this.ghostPos.y, this.ghostPos.z], this.ghostRot, this.activeBuilding()?.id, [this.wallLen / WALL_SEGMENT, 1, 1]);
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
    const active = this.activeBuilding();
    return active?.id === b.id ? useStore.getState().editFloor : 0;
  }

  private facadeBlockReason = '';

  /** Podgląd okna, balkonu i tarasu: przyciąga się do lica muru budynku z wnętrzem w miejscu. */
  private updateFacadeGhost() {
    if (!this.ghost || !this.ghostRing) return;
    const gp = new THREE.Vector3();
    if (!this.groundPoint(gp)) return;
    const st = useStore.getState();
    const found = this.findFacadeFor(this.ghostType, gp.x, gp.z, st.activeBuildingId ?? undefined);
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
    else this.ghostRot += Math.PI / 12;
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
    (this.ghostRing.material as THREE.MeshBasicMaterial).color.set(this.ghostAnchor ? '#2b6ea8' : blocked ? '#b4483d' : '#3f7550');
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
    if (mode !== 'editor' && this.topView) this.leaveTopView(true);
    if (mode === 'vr') {
      this.mode = 'vr';
      if (this.room) this.room.ceiling.visible = true;
      this.ensurePhysics();
      this.orbit.enabled = false;
      this.labelRenderer.domElement.style.display = 'none';
      this.enterVR().catch((err) => {
        console.error(err);
        useStore.getState().showToast('Nie udało się uruchomić VR: ' + (err as Error).message);
        useStore.getState().setViewMode('fp');
      });
      if (prevMode === 'editor') this.editorToFp();
      this.applyFloorVisibility();
      this.refreshLabels(this.lastPalace!);
      this.refreshPanels(this.lastPalace!);
      this.applySelection(useStore.getState().selectedIds, null);
      return;
    }
    if (prevMode === 'vr') this.exitVR();
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
    if (!this.renderer.xr.isPresenting && !this.stereo) {
      this.camera.position.set(0, EYE, 0);
      this.camera.rotation.set(this.pitch, 0, 0);
      this.camera.fov = 70;
      this.camera.updateProjectionMatrix();
    }
    this.tween = null;
    // kapsuła fizyki musi trafić w to samo miejsce, inaczej gracz wróciłby do starej pozycji
    this.physics?.teleport(tmpV3.set(pose.x, 0, pose.z));
  }

  private editorToFp() {
    this.placeRig(this.spawnPose());
  }

  private fpToEditor() {
    const fwd = tmpV.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const target = this.rig.position.clone().add(fwd.multiplyScalar(4)).setY(0.5);
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
      await this.renderer.xr.setSession(session);
      st.setVrActive(true);
      this.placeRig(this.spawnPose());
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
    this.placeRig(this.spawnPose());
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
        const r = this.renderer.domElement.getBoundingClientRect();
        if (ev.clientX - r.left > r.width * 0.35) this.touchLook = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false };
        return;
      }
      if (document.pointerLockElement === this.renderer.domElement) {
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
    if (this.mode === 'fp' && this.touchLook && ev.pointerId === this.touchLook.id) {
      const dx = ev.clientX - this.touchLook.x;
      const dy = ev.clientY - this.touchLook.y;
      this.touchLook.x = ev.clientX;
      this.touchLook.y = ev.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.touchLook.moved = true;
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
      if (this.touchLook && ev.pointerId === this.touchLook.id) {
        if (!this.touchLook.moved) {
          this.setPointer(ev);
          this.fpInteract(this.pick());
        }
        this.touchLook = null;
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
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.3, 1.3);
    this.rig.rotation.y = this.yaw;
    this.camera.rotation.set(this.pitch, 0, 0);
  }

  private onMouseMoveLocked = (ev: MouseEvent) => {
    if (document.pointerLockElement !== this.renderer.domElement) return;
    // rozglądanie myszą: w widoku z oczu zawsze, w trybie stereo tylko gdy głowy nie prowadzą czujniki
    const stereoLook = this.mode === 'vr' && !!this.stereo && !this.deviceOrient.active;
    if (this.mode !== 'fp' && !stereoLook) return;
    this.look(ev.movementX * 0.0022, ev.movementY * 0.0022);
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
    this.updateGhost();
  };

  private onLockChange = () => {
    useStore.setState({ toast: null });
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
        else if (!this.drawing() && !isFacade(this.ghostType)) this.ghostRot += Math.PI / 12;
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
    if (ev.code === 'KeyF' && this.mode === 'fp') {
      if (this.useDoor()) {
        ev.preventDefault();
        return;
      }
    }
    if (ev.code === 'Escape') {
      if (st.review && this.mode !== 'vr') st.endReview();
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
  private frame(frame?: XRFrame) {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const presenting = this.renderer.xr.isPresenting;

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
      if (presenting) this.readXrInput();
      this.updateFp(dt);
      if (this.debugPhysics && ++this.debugTick % 10 === 0) this.updatePhysicsDebug();
      if (this.stereo && this.deviceOrient.active) this.applyDeviceOrientation();
    }

    if (this.mode !== 'editor' && ++this.doorCheck % 6 === 0) this.updateDoorPrompt();

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
        // ściana znika, gdy jej zewnętrzna normalna celuje w kamerę (cos > 0,3)
        w.visible = nx * dx + nz * dz < 0.3 * Math.hypot(dx, dz);
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
    const hadFlash = this.weather.flash;
    this.weather.update(dt, camWorldPos);
    if (hadFlash !== this.weather.flash) this.applyLighting();
    if (hadFlash === 0 && this.weather.flash > 0) this.sounds.thunder();
    this.sounds.update(dt);
    for (const e of this.entries.values()) e.emitter?.update(dt, camWorldPos);
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
  }

  /** Opis otoczenia dla zwierząt: przeszkody, miejsca do siadania i ukształtowanie terenu. */
  private worldInfo(): WorldInfo {
    const obstacles: WorldInfo['obstacles'] = [];
    const perches: WorldInfo['perches'] = [];
    for (const e of this.entries.values()) {
      if (spawnKind(e.type)) continue;
      const r = e.footprint * 0.8 * hs(e);
      if (!e.inplace) obstacles.push({ x: e.group.position.x, z: e.group.position.z, r });
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
      clamp: (x, z) => this.clampXZ(x, z),
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
    if (dp.kind === 'exit') st.exitInterior();
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
      const a = Math.sign(turn) * -(Math.PI / 6);
      const head = this.renderer.xr.getCamera().getWorldPosition(tmpV2);
      this.rig.rotation.y += a;
      const dx = this.rig.position.x - head.x;
      const dz = this.rig.position.z - head.z;
      this.rig.position.x = head.x + dx * Math.cos(a) + dz * Math.sin(a);
      this.rig.position.z = head.z - dx * Math.sin(a) + dz * Math.cos(a);
      this.yaw = this.rig.rotation.y;
      this.physics?.teleport(tmpV3.set(this.rig.position.x, this.rig.position.y - this.headOffset, this.rig.position.z));
    } else if (Math.abs(turn) < 0.3) this.snapTurnArmed = false;
  }

  private updateFp(dt: number) {
    const k = this.keys;
    let mx = this.joystick.x + this.xrMove.x;
    let mz = this.joystick.y + this.xrMove.y;
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
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 6.5 : 3.6);
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
      const [cx, cz] = this.clampXZ(r.pos.x, r.pos.z);
      // granica planszy jest poza fizyką — po przycięciu trzeba przestawić też ciało
      if (Math.abs(cx - r.pos.x) > 1e-4 || Math.abs(cz - r.pos.z) > 1e-4) this.physics.teleport(tmpV3.set(cx, r.pos.y, cz));
      this.rig.position.set(cx, r.pos.y + this.headOffset, cz);
      return;
    }

    // rezerwowe kolizje kołowe, dopóki fizyka się nie wczyta
    if (this.fpVel.lengthSq() < 1e-6) return;
    const [nx, nz] = this.clampXZ(this.rig.position.x + this.fpVel.x * dt, this.rig.position.z + this.fpVel.z * dt);
    const [px, pz] = this.resolveCollisions(nx, nz);
    const [fx, fz] = this.clampXZ(px, pz);
    this.rig.position.x = fx;
    this.rig.position.z = fz;
  }

  /** Skok — także z przycisku na telefonie. */
  jump() {
    this.jumpBuffer = 0.15;
  }

  /** Wypycha punkt (x,z) poza obrysy obiektów. */
  private resolveCollisions(x: number, z: number, ignoreId?: string, margin = 0.35): [number, number] {
    let px = x;
    let pz = z;
    for (let iter = 0; iter < 3; iter++) {
      for (const e of this.entries.values()) {
        if (e.id === ignoreId || e.inplace) continue; // do budynku z wnętrzem w miejscu się wchodzi
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
    this.marquee?.el?.remove();
    this.marquee = null;
    for (const ring of this.selRings) this.scene.remove(ring);
    this.scene.remove(this.pivot);
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
