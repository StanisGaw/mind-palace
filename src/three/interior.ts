import * as THREE from 'three';
import type { RoomSpec } from '../types';
import { mat } from './builders';

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
  /** Miejsce, w którym gracz pojawia się po wejściu. */
  spawn: { pos: THREE.Vector3; yaw: number };
  /** Granice ruchu w poziomie. */
  bounds: { hx: number; hz: number };
  /** Bryły do fizyki (etap 5). */
  colliders: RoomBox[];
  dispose(): void;
}

const WALL_T = 0.3; // grubość ściany
const DOOR_W = 1.6;
const DOOR_H = 2.4;

/** Proceduralne wnętrze budynku: podłoga, ściany z otworem drzwiowym, okna, sufit i lampy. */
export function buildRoom(spec: RoomSpec, buildingType: string): Room {
  const g = new THREE.Group();
  const w = spec.width;
  const d = spec.depth;
  const h = spec.height;
  const colliders: RoomBox[] = [];

  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const walls: THREE.Mesh[] = [];
  const wall = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, normal?: [number, number]) => {
    const mesh = add(new THREE.BoxGeometry(sx, sy, sz), m, x, y, z);
    colliders.push({ size: [sx, sy, sz], pos: [x, y, z] });
    if (normal) {
      mesh.userData.wallNormal = normal;
      walls.push(mesh);
    }
    return mesh;
  };

  const wallMat = mat(spec.wall, { roughness: 0.95 });
  // podłoga ma własny materiał (nie z cache), bo może dostać teksturę
  const floorMat = new THREE.MeshStandardMaterial({ color: spec.floor, roughness: 1 });
  const trimMat = mat('#c7c0ae', { roughness: 0.9 });

  // podłoga i cokół
  const floor = add(new THREE.BoxGeometry(w, 0.24, d), floorMat, 0, -0.12, 0, false);
  floor.userData.ground = true;
  colliders.push({ size: [w, 0.24, d], pos: [0, -0.12, 0] });
  // dywan pośrodku
  add(new THREE.BoxGeometry(w * 0.45, 0.02, d * 0.45), mat('#b6836b', { roughness: 1 }), 0, 0.011, 0, false);

  // ściany: tylna, boczne, przednia z otworem drzwiowym
  wall(w, h, WALL_T, 0, h / 2, -d / 2, wallMat, [0, -1]);
  wall(WALL_T, h, d, -w / 2, h / 2, 0, wallMat, [-1, 0]);
  wall(WALL_T, h, d, w / 2, h / 2, 0, wallMat, [1, 0]);
  const sideW = (w - DOOR_W) / 2;
  wall(sideW, h, WALL_T, -(DOOR_W / 2 + sideW / 2), h / 2, d / 2, wallMat, [0, 1]);
  wall(sideW, h, WALL_T, DOOR_W / 2 + sideW / 2, h / 2, d / 2, wallMat, [0, 1]);
  wall(DOOR_W, h - DOOR_H, WALL_T, 0, DOOR_H + (h - DOOR_H) / 2, d / 2, wallMat, [0, 1]); // nadproże

  // framuga i uchylone skrzydło drzwi
  add(new THREE.BoxGeometry(DOOR_W + 0.24, DOOR_H + 0.12, 0.1), trimMat, 0, DOOR_H / 2, d / 2 - 0.02);
  add(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.06), mat('#20302a'), 0, DOOR_H / 2, d / 2 - 0.06, false);
  const door = add(new THREE.BoxGeometry(0.72, DOOR_H - 0.12, 0.07), mat('#8b6a4f'), -DOOR_W / 2 + 0.36, DOOR_H / 2 - 0.06, d / 2 - 0.28);
  door.rotation.y = -0.55;
  door.userData.exitDoor = true;
  door.userData.interactive = true;

  // okna: emisyjne prostokąty, imitują światło z zewnątrz
  const winMat = mat('#eaf2ff', { emissive: '#e7f0ff', roughness: 0.4 });
  const n = Math.max(0, spec.windows);
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const z = d * (k === 0 ? -0.18 : 0.2);
    add(new THREE.BoxGeometry(0.06, 1.5, 1.2), winMat, (side * w) / 2 + side * 0.02, h * 0.55, z, false);
    add(new THREE.BoxGeometry(0.1, 1.7, 1.4), trimMat, (side * w) / 2 - side * 0.04, h * 0.55, z, false);
  }
  // okno na tylnej ścianie dla większych wnętrz
  if (w >= 10) {
    add(new THREE.BoxGeometry(2.0, 1.6, 0.06), winMat, 0, h * 0.58, -d / 2 + 0.02, false);
    add(new THREE.BoxGeometry(2.2, 1.8, 0.1), trimMat, 0, h * 0.58, -d / 2 + 0.06, false);
  }

  // sufit (widoczny tylko w widoku z oczu — w edytorze zaglądamy do środka z góry)
  const ceiling = add(new THREE.BoxGeometry(w, 0.24, d), mat('#e8e2d5', { roughness: 1 }), 0, h + 0.12, 0, false);
  colliders.push({ size: [w, 0.24, d], pos: [0, h + 0.12, 0] });

  // listwa przypodłogowa
  add(new THREE.BoxGeometry(w, 0.16, 0.06), trimMat, 0, 0.08, -d / 2 + WALL_T / 2 + 0.03, false);

  // światła wnętrza
  const lampCount = w >= 12 ? 3 : 2;
  for (let i = 0; i < lampCount; i++) {
    const x = -w * 0.28 + (i * (w * 0.56)) / (lampCount - 1);
    const light = new THREE.PointLight('#ffe2b0', 14, Math.max(w, d), 2);
    light.position.set(x, h - 0.6, 0);
    g.add(light);
    add(new THREE.CylinderGeometry(0.3, 0.22, 0.18, 10), mat('#ffe7a3', { emissive: '#f6d68a' }), x, h - 0.5, 0, false);
  }

  // wieża ma dodatkowo schody prowadzące w górę (dekoracja)
  if (buildingType === 'tower') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 1.6;
      const r = w / 2 - 0.9;
      add(new THREE.BoxGeometry(1.0, 0.16, 0.7), mat('#b98a5c'), Math.cos(a) * r, 0.3 + i * 0.34, Math.sin(a) * r, true);
    }
  }

  return {
    group: g,
    ceiling,
    floor,
    exitDoor: door,
    walls,
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
