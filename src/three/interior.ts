import * as THREE from 'three';
import type { RoomSpec } from '../types';
import { mat } from './builders';
import type { Opening } from '../lib/rooms';

export interface RoomBox {
  size: [number, number, number];
  pos: [number, number, number];
}

export interface Room {
  group: THREE.Group;
  ceiling: THREE.Mesh;
  floor: THREE.Mesh;
  exitDoor: THREE.Mesh;
  /** Ściany z normalną skierowaną na zewnątrz — chowamy te od strony kamery. */
  walls: THREE.Mesh[];
  /** Jeden wpis na granicę pięter — grupa pudełek omijających otwory nad schodami. */
  slabs: THREE.Object3D[];
  /** Miejsce, w którym gracz pojawia się po wejściu (zawsze parter). */
  spawn: { pos: THREE.Vector3; yaw: number };
  /** Granice ruchu w poziomie (te same na każdym piętrze). */
  bounds: { hx: number; hz: number };
  /** Bryły do fizyki. */
  colliders: RoomBox[];
  dispose(): void;
}

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Wycina prostokątny otwór z listy prostokątów (podział na do czterech pasów wokół dziury). */
function subtractRect(rects: Rect[], hole: Rect): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    if (hole.x1 <= r.x0 || hole.x0 >= r.x1 || hole.z1 <= r.z0 || hole.z0 >= r.z1) {
      out.push(r);
      continue;
    }
    const ix0 = Math.max(r.x0, hole.x0);
    const ix1 = Math.min(r.x1, hole.x1);
    const iz0 = Math.max(r.z0, hole.z0);
    const iz1 = Math.min(r.z1, hole.z1);
    if (r.x0 < ix0) out.push({ x0: r.x0, x1: ix0, z0: r.z0, z1: r.z1 });
    if (ix1 < r.x1) out.push({ x0: ix1, x1: r.x1, z0: r.z0, z1: r.z1 });
    if (r.z0 < iz0) out.push({ x0: ix0, x1: ix1, z0: r.z0, z1: iz0 });
    if (iz1 < r.z1) out.push({ x0: ix0, x1: ix1, z0: iz1, z1: r.z1 });
  }
  return out;
}

const WALL_T = 0.3; // grubość ściany obwodowej
const DOOR_W = 1.6;
const DOOR_H = 2.4;
const SLAB_T = 0.24; // grubość stropu/sufitu/podłogi

/** Proceduralna powłoka budynku: podłoga, ściany każdej kondygnacji, stropy z otworami nad schodami, sufit. */
export function buildRoom(spec: RoomSpec, buildingType: string, opts: { floors: number; openings: Opening[][] }): Room {
  void buildingType; // rodzaj budynku nie wpływa już na powłokę — dekoracje wieży zastąpił preset ze schodami
  const g = new THREE.Group();
  const w = spec.width;
  const d = spec.depth;
  const h = spec.height;
  const floors = Math.max(1, opts.floors);
  const colliders: RoomBox[] = [];

  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const mm = new THREE.Mesh(geo, m);
    mm.position.set(x, y, z);
    mm.castShadow = shadow;
    mm.receiveShadow = true;
    return mm;
  };
  const walls: THREE.Mesh[] = [];
  const wall = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, floorIndex: number, normal?: [number, number]) => {
    const mm = mesh(new THREE.BoxGeometry(sx, sy, sz), m, x, y, z);
    g.add(mm);
    colliders.push({ size: [sx, sy, sz], pos: [x, y, z] });
    mm.userData.floorIndex = floorIndex;
    if (normal) {
      mm.userData.wallNormal = normal;
      walls.push(mm);
    }
    return mm;
  };

  const wallMat = mat(spec.wall, { roughness: 0.95 });
  // podłoga ma własny materiał (nie z cache), bo może dostać teksturę
  const floorMat = new THREE.MeshStandardMaterial({ color: spec.floor, roughness: 1 });
  const trimMat = mat('#c7c0ae', { roughness: 0.9 });

  // podłoga parteru i dywan pośrodku
  const floor = mesh(new THREE.BoxGeometry(w, SLAB_T, d), floorMat, 0, -SLAB_T / 2, 0, false);
  floor.userData.ground = true;
  g.add(floor);
  colliders.push({ size: [w, SLAB_T, d], pos: [0, -SLAB_T / 2, 0] });
  g.add(mesh(new THREE.BoxGeometry(w * 0.45, 0.02, d * 0.45), mat('#b6836b', { roughness: 1 }), 0, 0.011, 0, false));

  let exitDoor!: THREE.Mesh;
  for (let k = 0; k < floors; k++) {
    const y0 = k * h;
    wall(w, h, WALL_T, 0, y0 + h / 2, -d / 2, wallMat, k, [0, -1]); // tylna
    wall(WALL_T, h, d, -w / 2, y0 + h / 2, 0, wallMat, k, [-1, 0]); // lewa
    wall(WALL_T, h, d, w / 2, y0 + h / 2, 0, wallMat, k, [1, 0]); // prawa
    if (k === 0) {
      // parter: przednia ściana z otworem drzwiowym (wyjście na zewnątrz)
      const sideW = (w - DOOR_W) / 2;
      wall(sideW, h, WALL_T, -(DOOR_W / 2 + sideW / 2), y0 + h / 2, d / 2, wallMat, k, [0, 1]);
      wall(sideW, h, WALL_T, DOOR_W / 2 + sideW / 2, y0 + h / 2, d / 2, wallMat, k, [0, 1]);
      wall(DOOR_W, h - DOOR_H, WALL_T, 0, y0 + DOOR_H + (h - DOOR_H) / 2, d / 2, wallMat, k, [0, 1]); // nadproże
      g.add(mesh(new THREE.BoxGeometry(DOOR_W + 0.24, DOOR_H + 0.12, 0.1), trimMat, 0, y0 + DOOR_H / 2, d / 2 - 0.02, true));
      g.add(mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.06), mat('#20302a'), 0, y0 + DOOR_H / 2, d / 2 - 0.06, false));
      const door = mesh(new THREE.BoxGeometry(0.72, DOOR_H - 0.12, 0.07), mat('#8b6a4f'), -DOOR_W / 2 + 0.36, y0 + DOOR_H / 2 - 0.06, d / 2 - 0.28);
      door.rotation.y = -0.55;
      door.userData.exitDoor = true;
      door.userData.interactive = true;
      g.add(door);
      exitDoor = door;
    } else {
      wall(w, h, WALL_T, 0, y0 + h / 2, d / 2, wallMat, k, [0, 1]); // wyższe piętra: pełna ściana przednia
    }
  }

  // stropy między kondygnacjami: pudełka omijające otwory nad schodami z kondygnacji niżej
  const slabs: THREE.Object3D[] = [];
  for (let k = 0; k < floors - 1; k++) {
    const y = (k + 1) * h;
    let rects: Rect[] = [{ x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 }];
    for (const op of opts.openings[k] ?? []) {
      rects = subtractRect(rects, { x0: op.cx - op.hx, x1: op.cx + op.hx, z0: op.cz - op.hz, z1: op.cz + op.hz });
    }
    const slabGroup = new THREE.Group();
    for (const r of rects) {
      const sx = r.x1 - r.x0;
      const sz = r.z1 - r.z0;
      if (sx < 0.02 || sz < 0.02) continue;
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      slabGroup.add(mesh(new THREE.BoxGeometry(sx, SLAB_T, sz), mat('#e8e2d5', { roughness: 1 }), cx, y + SLAB_T / 2, cz, false));
      colliders.push({ size: [sx, SLAB_T, sz], pos: [cx, y + SLAB_T / 2, cz] });
    }
    g.add(slabGroup);
    slabs.push(slabGroup);
  }

  // sufit na najwyższej kondygnacji (widoczny tylko w widoku z oczu — w edytorze zaglądamy z góry)
  const topY = floors * h;
  const ceiling = mesh(new THREE.BoxGeometry(w, SLAB_T, d), mat('#e8e2d5', { roughness: 1 }), 0, topY + SLAB_T / 2, 0, false);
  g.add(ceiling);
  colliders.push({ size: [w, SLAB_T, d], pos: [0, topY + SLAB_T / 2, 0] });

  // listwa przypodłogowa
  // tył listwy schowany 0,01 m w ścianie — wspólna płaszczyzna z murem migotałaby
  g.add(mesh(new THREE.BoxGeometry(w, 0.16, 0.08), trimMat, 0, 0.08, -d / 2 + WALL_T / 2 + 0.03, false));

  return {
    group: g,
    ceiling,
    floor,
    exitDoor,
    walls,
    slabs,
    spawn: { pos: new THREE.Vector3(0, 0, d / 2 - 1.6), yaw: 0 },
    bounds: { hx: w / 2 - WALL_T / 2 - 0.35, hz: d / 2 - WALL_T / 2 - 0.35 },
    colliders,
    dispose() {
      g.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      floorMat.dispose();
      g.removeFromParent();
    },
  };
}
