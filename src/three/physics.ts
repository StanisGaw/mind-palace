import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { DOOR_LEAF_LOCAL } from './builders';

export type ColliderKind = 'trimesh' | 'box' | 'cylinder' | 'none';

export interface StaticShape {
  kind: ColliderKind;
  /** Model, z którego liczymy siatkę albo prostopadłościan (w lokalnych współrzędnych). */
  object?: THREE.Object3D;
  cylinder?: { r: number; h: number };
}

export interface RoomBoxInput {
  size: [number, number, number];
  pos: [number, number, number];
  /** Obrót bryły (kwaternion) — segmenty okrągłego muru i pochylnie kręconych schodów. */
  quat?: [number, number, number, number];
}

const CAPSULE_HALF = 0.55;
const CAPSULE_R = 0.32;
/** Odległość od środka kapsuły do stóp. */
export const FOOT_OFFSET = CAPSULE_HALF + CAPSULE_R;

let loadPromise: Promise<Physics> | null = null;

/**
 * Buduje siatkę kolizyjną z modelu: pojedyncza tablica wierzchołków i indeksów
 * we współrzędnych lokalnych modelu, przeskalowana skalą obiektu.
 */
function buildTrimesh(root: THREE.Object3D, scale: THREE.Vector3): { vertices: Float32Array; indices: Uint32Array } | null {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const verts: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    if (mesh.userData.skipCollider) return; // skrzydło drzwi i widoczne stopnie schodów mają własną/inną bryłę
    const geo = mesh.geometry;
    if (!geo?.attributes?.position) return;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    // drobne ozdoby (kwiatki, gałki) pomijamy — nie wpływają na chodzenie
    const maxScale = Math.max(scale.x, scale.y, scale.z);
    if ((geo.boundingSphere?.radius ?? 0) * mesh.matrixWorld.getMaxScaleOnAxis() * maxScale < 0.12) return;
    m.copy(inv).multiply(mesh.matrixWorld);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const offset = verts.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m).multiply(scale);
      verts.push(v.x, v.y, v.z);
    }
    if (geo.index) {
      const a = geo.index.array;
      for (let i = 0; i < a.length; i++) idx.push(a[i] + offset);
    } else {
      for (let i = 0; i < pos.count; i++) idx.push(i + offset);
    }
  });
  if (idx.length < 3) return null;
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

/** Ramka ograniczająca modelu w jego lokalnych współrzędnych. */
function localBox(root: THREE.Object3D, scale: THREE.Vector3) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()).multiply(scale);
  const center = box.getCenter(new THREE.Vector3()).multiply(scale);
  return { size, center };
}

export class Physics {
  private R: typeof RAPIER;
  private world: RAPIER.World;
  private controller: RAPIER.KinematicCharacterController;
  private statics = new Map<string, RAPIER.RigidBody>();
  private ground: RAPIER.RigidBody | null = null;
  private terrainBody: RAPIER.RigidBody | null = null;
  private roomBody: RAPIER.RigidBody | null = null;
  private charBody: RAPIER.RigidBody | null = null;
  private charCollider: RAPIER.Collider | null = null;
  private vy = 0;
  private grounded = false;

  static load(): Promise<Physics> {
    if (!loadPromise) {
      loadPromise = import('@dimforge/rapier3d-compat').then(async (mod) => {
        const R = (mod as unknown as { default?: typeof RAPIER }).default ?? (mod as unknown as typeof RAPIER);
        await R.init();
        return new Physics(R);
      });
    }
    return loadPromise;
  }

  constructor(R: typeof RAPIER) {
    this.R = R;
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.controller = this.world.createCharacterController(0.03);
    this.controller.enableAutostep(0.45, 0.22, true);
    this.controller.enableSnapToGround(0.5);
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((58 * Math.PI) / 180);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
  }

  /** Czyści świat (przełączenie sceny) — wszystkie ciała poza kontrolerem. */
  reset() {
    for (const b of this.statics.values()) this.world.removeRigidBody(b);
    this.statics.clear();
    for (const b of [this.ground, this.terrainBody, this.roomBody]) if (b) this.world.removeRigidBody(b);
    this.ground = null;
    this.terrainBody = null;
    this.roomBody = null;
  }

  private fixedBody(x = 0, y = 0, z = 0, q?: THREE.Quaternion) {
    const desc = this.R.RigidBodyDesc.fixed().setTranslation(x, y, z);
    if (q) desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    return this.world.createRigidBody(desc);
  }

  /**
   * Płyta narysowana kaflami: po jednym pudełku na scalony prostokąt. Prostokąty powiększamy o centymetr,
   * żeby kolidery zazębiały się i kontroler postaci nie zaczepiał o szew między nimi.
   */
  setGroundParts(rects: { x0: number; x1: number; z0: number; z1: number }[], thickness = 0.6) {
    if (this.ground) this.world.removeRigidBody(this.ground);
    this.ground = this.fixedBody(0, 0, 0);
    for (const r of rects) {
      const hx = (r.x1 - r.x0) / 2 + 0.01;
      const hz = (r.z1 - r.z0) / 2 + 0.01;
      this.world.createCollider(
        this.R.ColliderDesc.cuboid(hx, thickness / 2, hz).setTranslation((r.x0 + r.x1) / 2, -thickness / 2, (r.z0 + r.z1) / 2),
        this.ground,
      );
    }
  }

  /** Płyta o dowolnym obrysie: prostokąt jako pudełko, koło i sześciokąt jako bryła wypukła. */
  setGroundShape(polygon: [number, number][], thickness = 0.6) {
    if (this.ground) this.world.removeRigidBody(this.ground);
    this.ground = this.fixedBody(0, 0, 0);
    if (polygon.length === 4) {
      const hx = Math.max(...polygon.map((p) => Math.abs(p[0])));
      const hz = Math.max(...polygon.map((p) => Math.abs(p[1])));
      this.world.createCollider(this.R.ColliderDesc.cuboid(hx, thickness / 2, hz).setTranslation(0, -thickness / 2, 0), this.ground);
      return;
    }
    const pts = new Float32Array(polygon.length * 6);
    polygon.forEach((p, i) => {
      pts[i * 6] = p[0];
      pts[i * 6 + 1] = 0;
      pts[i * 6 + 2] = p[1];
      pts[i * 6 + 3] = p[0];
      pts[i * 6 + 4] = -thickness;
      pts[i * 6 + 5] = p[1];
    });
    const desc = this.R.ColliderDesc.convexHull(pts);
    if (desc) this.world.createCollider(desc, this.ground);
    else {
      const r = Math.max(...polygon.map((p) => Math.hypot(p[0], p[1])));
      this.world.createCollider(this.R.ColliderDesc.cuboid(r, thickness / 2, r).setTranslation(0, -thickness / 2, 0), this.ground);
    }
  }

  setTerrain(mesh: THREE.Mesh | null) {
    if (this.terrainBody) {
      this.world.removeRigidBody(this.terrainBody);
      this.terrainBody = null;
    }
    if (!mesh) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const verts = new Float32Array(pos.array as ArrayLike<number>);
    const index = geo.index;
    if (!index) return;
    const idx = new Uint32Array(index.array as ArrayLike<number>);
    this.terrainBody = this.fixedBody(mesh.position.x, mesh.position.y, mesh.position.z);
    this.world.createCollider(this.R.ColliderDesc.trimesh(verts, idx), this.terrainBody);
  }

  setRoom(boxes: RoomBoxInput[] | null, meshes: { vertices: Float32Array; indices: Uint32Array }[] = []) {
    if (this.roomBody) {
      this.world.removeRigidBody(this.roomBody);
      this.roomBody = null;
    }
    if ((!boxes || boxes.length === 0) && meshes.length === 0) return;
    this.roomBody = this.fixedBody(0, 0, 0);
    for (const m of meshes) this.world.createCollider(this.R.ColliderDesc.trimesh(m.vertices, m.indices), this.roomBody);
    if (!boxes) return;
    for (const b of boxes) {
      const desc = this.R.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2).setTranslation(b.pos[0], b.pos[1], b.pos[2]);
      if (b.quat) desc.setRotation({ x: b.quat[0], y: b.quat[1], z: b.quat[2], w: b.quat[3] });
      this.world.createCollider(desc, this.roomBody);
    }
  }

  setStatic(id: string, shape: StaticShape, position: THREE.Vector3, quaternion: THREE.Quaternion, scale: THREE.Vector3) {
    this.removeStatic(id);
    if (shape.kind === 'none') return;
    const body = this.fixedBody(position.x, position.y, position.z, quaternion);
    this.statics.set(id, body);
    if (shape.kind === 'cylinder' && shape.cylinder) {
      const r = shape.cylinder.r * Math.max(scale.x, scale.z);
      const h = shape.cylinder.h * scale.y;
      this.world.createCollider(this.R.ColliderDesc.cylinder(h / 2, r).setTranslation(0, h / 2, 0), body);
      return;
    }
    if (!shape.object) return;
    if (shape.kind === 'trimesh') {
      const tri = buildTrimesh(shape.object, scale);
      if (tri) {
        this.world.createCollider(this.R.ColliderDesc.trimesh(tri.vertices, tri.indices), body);
        return;
      }
    }
    const { size, center } = localBox(shape.object, scale);
    if (size.x < 1e-3 || size.y < 1e-3 || size.z < 1e-3) return;
    this.world.createCollider(this.R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(center.x, center.y, center.z), body);
  }

  /** Tania aktualizacja pozycji bez przebudowy siatki. */
  moveStatic(id: string, position: THREE.Vector3, quaternion: THREE.Quaternion) {
    const body = this.statics.get(id);
    if (!body) return false;
    body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    body.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, true);
    return true;
  }

  /**
   * Kolizja skrzydła drzwi obiektowych: zamknięte dostają bryłę na stałych współrzędnych z `builders.ts`
   * (nie przez siatkę trójkątów modelu — pivot już był renderowany, więc jego `matrixWorld` nie jest
   * „świeży" i licząc z niego wprost dublowałby przesunięcie), otwarte tracą kolizję całkowicie.
   */
  setLeaf(id: string, closed: boolean, position: THREE.Vector3, quaternion: THREE.Quaternion, scale: THREE.Vector3, leaf: { size: [number, number, number]; center: [number, number, number] } = DOOR_LEAF_LOCAL) {
    this.removeStatic(id + ':leaf');
    if (!closed) return;
    const body = this.fixedBody(position.x, position.y, position.z, quaternion);
    this.statics.set(id + ':leaf', body);
    const { size, center } = leaf;
    const desc = this.R.ColliderDesc.cuboid((size[0] * scale.x) / 2, (size[1] * scale.y) / 2, (size[2] * scale.z) / 2).setTranslation(
      center[0] * scale.x,
      center[1] * scale.y,
      center[2] * scale.z,
    );
    this.world.createCollider(desc, body);
  }

  removeStatic(id: string) {
    const body = this.statics.get(id);
    if (!body) return;
    this.world.removeRigidBody(body);
    this.statics.delete(id);
  }

  createCharacter(footPos: THREE.Vector3) {
    if (this.charBody) this.world.removeRigidBody(this.charBody);
    const desc = this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(footPos.x, footPos.y + FOOT_OFFSET, footPos.z);
    this.charBody = this.world.createRigidBody(desc);
    this.charCollider = this.world.createCollider(this.R.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_R), this.charBody);
    this.vy = 0;
    this.grounded = false;
    // rozgrzewa potok zapytań (broad-phase) świata fizyki, żeby pierwsze computeColliderMovement
    // po odbudowie sceny (świeży World, np. wejście do wnętrza zanim ktokolwiek ruszył postacią)
    // widziało już wszystkie bryły, a nie zwracało zerowy ruch
    this.world.step();
  }

  teleport(footPos: THREE.Vector3) {
    if (!this.charBody) return;
    this.charBody.setTranslation({ x: footPos.x, y: footPos.y + FOOT_OFFSET, z: footPos.z }, true);
    this.charBody.setNextKinematicTranslation({ x: footPos.x, y: footPos.y + FOOT_OFFSET, z: footPos.z });
    this.vy = 0;
    this.world.step();
  }

  get hasCharacter() {
    return !!this.charBody;
  }

  /** Jeden krok postaci: grawitacja, skok, ślizganie po przeszkodach. Zwraca pozycję stóp. */
  stepCharacter(velXZ: THREE.Vector3, dt: number, jump: boolean): { pos: THREE.Vector3; grounded: boolean } {
    const body = this.charBody;
    const collider = this.charCollider;
    const cur = body?.translation() ?? { x: 0, y: FOOT_OFFSET, z: 0 };
    if (!body || !collider) return { pos: new THREE.Vector3(cur.x, cur.y - FOOT_OFFSET, cur.z), grounded: false };

    this.vy -= 20 * dt;
    if (this.grounded) {
      if (jump) this.vy = 7.0;
      // lekki docisk do podłoża: mocniejszy (3 m/s) zjadał ruch po pochylniach — na 41° zostawało 0,5 m/s
      else if (this.vy < 0) this.vy = -0.5;
    }
    const desired = { x: velXZ.x * dt, y: this.vy * dt, z: velXZ.z * dt };
    this.controller.computeColliderMovement(collider, desired);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;
    // uderzenie w sufit
    if (!this.grounded && this.vy > 0 && mv.y < desired.y * 0.5) this.vy = 0;
    const next = { x: cur.x + mv.x, y: cur.y + mv.y, z: cur.z + mv.z };
    body.setNextKinematicTranslation(next);
    this.world.timestep = dt;
    this.world.step();
    return { pos: new THREE.Vector3(next.x, next.y - FOOT_OFFSET, next.z), grounded: this.grounded };
  }

  /** Linie debugowania (URL ?physdebug=1). */
  debugBuffers(): { vertices: Float32Array; colors: Float32Array } {
    const b = this.world.debugRender();
    return { vertices: b.vertices, colors: b.colors };
  }

  dispose() {
    this.world.free();
  }
}
