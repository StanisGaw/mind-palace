import * as THREE from 'three';
import { DRAW_MIN, DRAW_PULL, SPEED_FULL, arrowSpeed, drawStrength, newArrow, stepArrow, sway, type ArrowState } from '../lib/archery';
import { buildArrow, buildBow, disposeObject } from './builders';

/**
 * Strzelanie z łuku: łuk w dłoni, strzały w locie i strzały wbite w to, co trafiły.
 * Modul nie zna wpisów sceny — promień trafienia i macierz trafionego obiektu dostaje od `SceneManager`.
 */

/** Trafienie na odcinku lotu. */
export interface ArrowHit {
  point: THREE.Vector3;
  /** Wpis biblioteki, w który weszła strzała; `null` dla terenu, płyty i murów pokoju. */
  objectId: string | null;
}

export type CastArrow = (from: THREE.Vector3, dir: THREE.Vector3, dist: number) => ArrowHit | null;
/** Macierz świata wpisu, w którym siedzi strzała; `null`, gdy wpis zniknął ze sceny. */
export type EntryMatrix = (objectId: string) => THREE.Matrix4 | null;

/** Tyle strzał zostaje w świecie; najstarsza gaśnie, gdy przyjdzie kolejna. */
const MAX_STUCK = 32;
const FADE = 0.4;
/** Strzała, która nic nie trafiła (poleciała w niebo, za planszę), znika po tym czasie. */
const MAX_FLIGHT = 6;
/**
 * Drganie po wbiciu: amplituda [rad], częstotliwość [Hz] i tłumienie wykładnicze. Przy 0,7-metrowym
 * drzewcu 0,1 rad to 7 cm wychylenia ogona — mniej ginie w pikselach z odległości strzelania.
 */
const WOBBLE = { amp: 0.1, hz: 11, damp: 4.5 };
/** Strzała startuje przed twarzą, żeby nie wychodziła z oka gracza. */
const MUZZLE = 0.45;
/** Głębokość wbicia [m]: wolna strzała ledwie się trzyma, szybka wchodzi po lotki. */
const DEPTH = { min: 0.03, max: 0.14 };

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

/** Rozciąga walec jednostkowy (osi Y) między dwoma punktami — połowa cięciwy. */
function stretch(mesh: THREE.Object3D | undefined, from: THREE.Vector3, to: THREE.Vector3) {
  if (!mesh) return;
  const len = from.distanceTo(to);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, tmpV3.copy(to).sub(from).divideScalar(len || 1));
}

interface Flying {
  group: THREE.Group;
  state: ArrowState;
}

interface Stuck {
  group: THREE.Group;
  /** Drzewce obracane wokół grotu — to ono drga po wbiciu. */
  shaft: THREE.Object3D;
  objectId: string | null;
  /** Transform strzały w układzie trafionego wpisu — strzała jedzie z nim, gdy ten się rusza. */
  local: THREE.Matrix4;
  age: number;
  /** Siła uderzenia 0…1 — amplituda drgania. */
  strength: number;
  fade: number | null;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpV3 = new THREE.Vector3();

export class Archery {
  /** Strzały w locie i wbite — grupa w układzie świata. */
  readonly object = new THREE.Group();
  /** Łuk w dłoni — grupa doczepiana do kamery. */
  readonly hand = new THREE.Group();
  /** Naciąg 0…1 — scena czyta go dla przybliżenia i celownika. */
  draw = 0;
  /** Drżenie ręki: obrót w poziomie i w pionie [rad]. */
  swayXY: [number, number] = [0, 0];

  private bow = buildBow();
  private proto = buildArrow();
  private strings: THREE.Object3D[] = [];
  private nocked: THREE.Group;
  private flying: Flying[] = [];
  private stuck: Stuck[] = [];
  private pulling = false;
  private held = 0;
  private fullHeld = 0;
  private time = 0;
  /** Naciąg zaklepany przy puszczeniu cięciwy — wystrzał liczy `update`, bo tam jest kamera. */
  private release: number | null = null;

  constructor() {
    this.hand.add(this.bow);
    // łuk trzymany metr przed twarzą przy kącie 70° zajmowałby cały ekran — w dłoni jest o połowę mniejszy
    this.hand.scale.setScalar(0.45);
    for (const name of ['string0', 'string1']) {
      const m = this.bow.getObjectByName(name);
      if (m) this.strings.push(m);
    }
    this.nocked = this.proto.clone();
    this.bow.add(this.nocked);
    this.poseBow(0);
  }

  /** Naciąg: `true`, dopóki gracz trzyma cięciwę. */
  setPulling(v: boolean) {
    if (v === this.pulling) return;
    if (!v && this.draw >= DRAW_MIN) this.release = this.draw;
    this.pulling = v;
    if (!v) {
      this.held = 0;
      this.fullHeld = 0;
      this.draw = 0;
    }
  }

  update(dt: number, camera: THREE.Camera, cast: CastArrow, entryMatrix: EntryMatrix) {
    this.time += dt;
    if (this.pulling) {
      this.held += dt;
      this.draw = drawStrength(this.held);
      if (this.draw >= 1) this.fullHeld += dt;
    }
    this.swayXY = this.pulling ? sway(this.fullHeld, this.time) : [0, 0];
    this.poseBow(this.draw);
    if (this.release !== null) {
      this.shoot(camera, cast, entryMatrix, this.release);
      this.release = null;
    }
    this.updateFlying(dt, cast, entryMatrix);
    this.updateStuck(dt, entryMatrix);
  }

  /** Łuk przy naciągu wychodzi na środek widoku i prostuje się; cięciwa i strzała jadą do tyłu. */
  private poseBow(draw: number) {
    this.hand.position.set(-0.28 + 0.09 * draw, -0.26 + 0.06 * draw, -0.85 + 0.07 * draw);
    // łuk trzymany skośnie, żeby widać było wygięcie ramion; przy naciągu prostuje się, ale nie staje
    // płasko do ekranu — wtedy wyglądałby jak kij i zasłaniałby środek widoku
    this.hand.rotation.set(0.04 + 0.04 * draw, 0.6 - 0.24 * draw, -0.36 + 0.16 * draw);
    const nock = 0.07 + DRAW_PULL * draw;
    stretch(this.strings[0], tmpV.set(0, 0.52, 0.07), tmpV2.set(0, 0, nock));
    stretch(this.strings[1], tmpV.set(0, -0.52, 0.07), tmpV2.set(0, 0, nock));
    // grot 0,69 m przed nasadą: strzała cofa się razem z cięciwą
    this.nocked.position.set(0.03, 0.052, nock - 0.69);
  }

  private shoot(camera: THREE.Camera, cast: CastArrow, entryMatrix: EntryMatrix, draw: number) {
    const speed = arrowSpeed(draw);
    camera.getWorldPosition(tmpV);
    camera.getWorldDirection(tmpV2);
    // gdy tuż przed twarzą stoi ściana, strzała wbija się w nią od razu, a nie za nią
    const blocked = cast(tmpV, tmpV2, MUZZLE);
    if (blocked) {
      this.stick(blocked, tmpV2, speed, entryMatrix);
      return;
    }
    const from = tmpV.clone().addScaledVector(tmpV2, MUZZLE);
    const group = this.proto.clone();
    group.position.copy(from);
    group.quaternion.setFromUnitVectors(FORWARD, tmpV2);
    this.object.add(group);
    this.flying.push({ group, state: newArrow([from.x, from.y, from.z], [tmpV2.x, tmpV2.y, tmpV2.z], speed) });
  }

  private updateFlying(dt: number, cast: CastArrow, entryMatrix: EntryMatrix) {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      const s = stepArrow(f.state, dt);
      if (s.len > 1e-6) {
        tmpV2.set(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0).divideScalar(s.len);
        // promień szuka trafienia na całym odcinku klatki, z zapasem na grubość grotu
        const hit = cast(tmpV.set(s.x0, s.y0, s.z0), tmpV2, s.len + 0.05);
        if (hit) {
          this.stick(hit, tmpV2, Math.hypot(f.state.vx, f.state.vy, f.state.vz), entryMatrix);
          this.remove(f.group);
          this.flying.splice(i, 1);
          continue;
        }
        f.group.quaternion.setFromUnitVectors(FORWARD, tmpV2);
      }
      f.group.position.set(s.x1, s.y1, s.z1);
      if (f.state.t > MAX_FLIGHT || f.state.y < -30) {
        this.remove(f.group);
        this.flying.splice(i, 1);
      }
    }
  }

  private stick(hit: ArrowHit, dir: THREE.Vector3, speed: number, entryMatrix: EntryMatrix) {
    const depth = THREE.MathUtils.clamp(DEPTH.min + (speed / SPEED_FULL) * (DEPTH.max - DEPTH.min), DEPTH.min, DEPTH.max);
    const group = new THREE.Group();
    const shaft = this.proto.clone();
    group.add(shaft);
    group.position.copy(hit.point).addScaledVector(dir, depth);
    group.quaternion.setFromUnitVectors(FORWARD, dir);
    this.object.add(group);
    const st: Stuck = { group, shaft, objectId: hit.objectId, local: new THREE.Matrix4(), age: 0, strength: Math.min(speed / SPEED_FULL, 1), fade: null };
    if (hit.objectId) {
      const m = entryMatrix(hit.objectId);
      if (m) {
        group.updateMatrix();
        st.local.copy(tmpM.copy(m).invert()).multiply(group.matrix);
      } else st.objectId = null;
    }
    this.stuck.push(st);
    // ponad limit: najstarsza strzała gaśnie, żeby nie znikała skokiem
    let alive = this.stuck.reduce((n, s) => n + (s.fade === null ? 1 : 0), 0);
    for (const s of this.stuck) {
      if (alive <= MAX_STUCK) break;
      if (s.fade === null) {
        s.fade = 0;
        alive--;
      }
    }
  }

  private updateStuck(dt: number, entryMatrix: EntryMatrix) {
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const s = this.stuck[i];
      s.age += dt;
      if (s.objectId) {
        const m = entryMatrix(s.objectId);
        // obiekt zniknął ze sceny (usunięty, przebudowany) — strzała nie ma już w czym siedzieć
        if (!m) s.fade ??= 0;
        else {
          tmpM.multiplyMatrices(m, s.local).decompose(tmpV, tmpQ, tmpS);
          // skalę wpisu pomijamy: powiększona tarcza nie ma powiększać wbitej w nią strzały.
          // Przy skali różnej na osiach obrót z rozkładu macierzy jest przybliżony — strzała może
          // wtedy stać o ułamek stopnia inaczej, co przy tarczy rozciągniętej w jednej osi nie razi
          s.group.position.copy(tmpV);
          s.group.quaternion.copy(tmpQ);
        }
      }
      const amp = WOBBLE.amp * s.strength * Math.exp(-WOBBLE.damp * s.age);
      const phase = 2 * Math.PI * WOBBLE.hz * s.age;
      s.shaft.rotation.set(amp * Math.sin(phase), amp * 0.6 * Math.sin(phase + 1.1), 0);
      if (s.fade !== null) {
        s.fade += dt;
        const k = Math.min(s.fade / FADE, 1);
        s.shaft.scale.setScalar(1 - k);
        if (k >= 1) {
          this.remove(s.group);
          this.stuck.splice(i, 1);
        }
      }
    }
  }

  private remove(group: THREE.Object3D) {
    group.removeFromParent();
  }

  dispose() {
    for (const f of this.flying) this.remove(f.group);
    for (const s of this.stuck) this.remove(s.group);
    this.flying = [];
    this.stuck = [];
    this.object.removeFromParent();
    this.hand.removeFromParent();
    // klony strzały dzielą geometrię z prototypem, więc zwalniamy ją raz — po usunięciu wszystkich klonów
    disposeObject(this.proto);
    disposeObject(this.bow);
  }
}
