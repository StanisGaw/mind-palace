import * as THREE from 'three';
import { DRAW_MIN, DRAW_PULL, SPEED_FULL, arrowSpeed, drawStrength, newArrow, stepArrow, sway, type ArrowState } from '../lib/archery';
import { ARROW_NOCK, BOW_BRACE, BOW_STRING_ANCHOR, buildArrow, buildBow, buildGlovedHand, disposeObject } from './builders';

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

/**
 * Ustawia dłoń: przedramię (lokalne −Y) idzie w podanym kierunku, a palce (lokalne +Z) patrzą
 * wzdłuż `face` w osi Z łuku. Bez drugiej osi obrót wokół przedramienia wychodzi dowolny i palce
 * zaciskają się w powietrzu obok cięciwy zamiast na niej.
 */
function aimHand(hand: THREE.Object3D, x: number, y: number, z: number, face: 1 | -1) {
  const yAxis = tmpV4.set(-x, -y, -z).normalize();
  const zAxis = tmpV5.set(0, 0, face).addScaledVector(yAxis, -tmpV5.dot(yAxis)).normalize();
  const xAxis = tmpV6.crossVectors(yAxis, zAxis).normalize();
  tmpM2.makeBasis(xAxis, yAxis, zAxis);
  hand.quaternion.setFromRotationMatrix(tmpM2);
}

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
const tmpV4 = new THREE.Vector3();
const tmpV5 = new THREE.Vector3();
const tmpV6 = new THREE.Vector3();
const tmpM2 = new THREE.Matrix4();

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
  private bowHand = buildGlovedHand('bow');
  private drawHand = buildGlovedHand('draw');
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
    // łuk ma prawdziwą długość (1,64 m) i ramiona wychodzą za kadr, jak na referencji — grupa pomocnicza
    // zostaje więc w skali 1, a kadr ustawia sama odległość od kamery
    for (const name of ['string0', 'string1']) {
      const m = this.bow.getObjectByName(name);
      if (m) this.strings.push(m);
    }
    this.nocked = this.proto.clone();
    this.bow.add(this.nocked);
    this.hand.add(this.bowHand, this.drawHand);
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
    // łuk trzyma prawa dłoń w prawej części kadru (jak na referencji), przekrzywiony o ~17°;
    // przy naciągu ramię wyciąga się do przodu i łuk prostuje się do pionu
    // Strzała leży w płaszczyźnie łuku i celuje tam, gdzie patrzy kamera, więc łuk prawie nie jest
    // obrócony w poziomie — inaczej strzała leciałaby obok celownika. Za to jest przekrzywiony (cant),
    // dzięki czemu górne ramię wychodzi prawym górnym narożnikiem, a dolne chowa się za przedramieniem.
    // Punkt zaczepienia (nasada przy pełnym naciągu) ma wypaść nieco pod okiem i 0,45 m przed nim —
    // stąd pozycja grupy jest policzona od niego wstecz, a nie dobrana na oko.
    this.hand.position.set(0.13 - 0.044 * draw, -0.2 + 0.07 * draw, -0.8 - 0.093 * draw);
    this.hand.rotation.set(0.02 + 0.02 * draw, -0.08, -0.38 + 0.06 * draw);
    const nock = BOW_BRACE + DRAW_PULL * draw;
    // cięciwa odchodzi od ramienia w miejscu, gdzie kończy się podparcie na recurve
    const [ay, az] = BOW_STRING_ANCHOR;
    stretch(this.strings[0], tmpV.set(0, ay, az), tmpV2.set(0, 0, nock));
    stretch(this.strings[1], tmpV.set(0, -ay, az), tmpV2.set(0, 0, nock));
    // strzała wisi nasadą na cięciwie i cofa się razem z nią; leży przy majdanie od strony strzelca
    this.nocked.position.set(-0.028, 0, nock - ARROW_NOCK);

    // dłoń łucznicza trzyma majdan i stoi w miejscu; dłoń cięciwy jedzie z nasadą do oka strzelca
    // dłoń łucznicza: palce zamykają się na majdanie od strony strzelca, dłoń leży na jego grzbiecie
    this.bowHand.position.set(0.015, -0.02, 0.02);
    aimHand(this.bowHand, 0.72, -0.64, 0.26, 1);
    // przedramię cięciwy wychodzi lewym dolnym narożnikiem, jak na referencji; wycelowane w obiektyw
    // zalewało cały dolny róg kadru
    // dłoń cięciwy: palce hakują cięciwę od tyłu, więc patrzą w stronę celu
    this.drawHand.position.set(-0.025, -0.03, nock + 0.035);
    aimHand(this.drawHand, -0.7, -0.64, 0.31, -1);
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
