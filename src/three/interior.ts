import * as THREE from 'three';
import type { RoomSpec } from '../types';
import { discRects, finishMat, glassMat, mat, scaleUv, spiralStairs, wallGeometry, woodMat, type Trimesh } from './builders';
import { SHELLS, SHELL_WINDOWS, type Opening, type WallHole } from '../lib/rooms';
import { skyTexture } from './art';

export interface RoomBox {
  size: [number, number, number];
  pos: [number, number, number];
  quat?: [number, number, number, number];
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
  /** Siatki kolizji (helikalne wstęgi schodów). */
  trimeshes: Trimesh[];
  dispose(): void;
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Wycina prostokątny otwór z listy prostokątów (podział na do czterech pasów wokół dziury). */
export function subtractRect(rects: Rect[], hole: Rect): Rect[] {
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

/** Okno pokoju ładowanego w metrach — położenie bierze z elewacji, wymiary są stałe (pokój jest dużo większy od bryły). */
function roomWindowSize(h: number) {
  const sill = 0.95;
  return { w: 1.3, h: Math.max(0.8, Math.min(1.5, h - sill - 0.5)), sill };
}

/** Otwory okien elewacji na ścianie `key`, w metrach od środka ściany; `along` przelicza `u` bryły na pokój. */
function roomWindowHoles(type: string, key: string, along: number, size: { w: number; h: number; sill: number }): WallHole[] {
  return (SHELL_WINDOWS[type] ?? []).filter((x) => x.wall === key).map((x) => ({ u0: x.u * along - size.w / 2, u1: x.u * along + size.w / 2, v0: size.sill, v1: size.sill + size.h }));
}

let dayMat: THREE.MeshBasicMaterial | null = null;
/** Jasna płaszczyzna za szybą — nieoświetlona, żeby czytała się jak dzień na zewnątrz. Współdzielona. */
function dayMaterial() {
  if (!dayMat) dayMat = new THREE.MeshBasicMaterial({ map: skyTexture() });
  return dayMat;
}

/**
 * Okno pokoju: rama i szczebliny, szyba, parapet wewnętrzny i „dzień” za szybą. Grupa stoi na licu ściany
 * w punkcie (x, y, z) z lokalnym +Z na zewnątrz (`yaw` z normalnej ściany).
 */
function roomWindow(g: THREE.Group, x: number, y: number, z: number, yaw: number, w: number, h: number) {
  const win = new THREE.Group();
  win.position.set(x, y, z);
  win.rotation.y = yaw;
  const frame = woodMat('#8b6a4f');
  const t = 0.08;
  const depth = WALL_T + 0.02;
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => {
    const mm = new THREE.Mesh(geo, m);
    mm.position.set(px, py, pz);
    mm.castShadow = false;
    mm.receiveShadow = true;
    win.add(mm);
    return mm;
  };
  part(new THREE.BoxGeometry(t, h, depth), frame, -w / 2 + t / 2, 0, 0);
  part(new THREE.BoxGeometry(t, h, depth), frame, w / 2 - t / 2, 0, 0);
  part(new THREE.BoxGeometry(w, t, depth), frame, 0, h / 2 - t / 2, 0);
  part(new THREE.BoxGeometry(w, t, depth), frame, 0, -h / 2 + t / 2, 0);
  part(new THREE.BoxGeometry(0.04, h - t * 2, 0.05), frame, 0, 0, 0);
  part(new THREE.BoxGeometry(w - t * 2, 0.04, 0.05), frame, 0, 0, 0);
  part(new THREE.BoxGeometry(w - t * 2, h - t * 2, 0.01), glassMat(), 0, 0, 0);
  part(new THREE.BoxGeometry(w + 0.2, 0.04, 0.22), mat('#c7c0ae', { roughness: 0.9 }), 0, -h / 2 - 0.02, -WALL_T / 2 - 0.06); // parapet
  // dzień za oknem: płaszczyzna odwrócona do środka, nieco większa od otworu, żeby brzegów nie było widać z ukosa
  const day = part(new THREE.PlaneGeometry(w + 1.2, h + 1.2), dayMaterial(), 0, 0.2, WALL_T / 2 + 0.35);
  day.rotation.y = Math.PI;
  day.receiveShadow = false;
  g.add(win);
}

/** Proceduralna powłoka budynku: podłoga, ściany każdej kondygnacji, stropy z otworami nad schodami, sufit. */
export interface RoomOpts {
  floors: number;
  openings: Opening[][];
  /** Tekstura ścian (id z `textures.ts`); brak = kolor z `RoomSpec`. */
  wallTexture?: string;
}

/** Kafel tekstury ścian pokoju w metrach. */
const WALL_TILE = 2.5;

export function buildRoom(spec: RoomSpec, buildingType: string, opts: RoomOpts): Room {
  if (buildingType === 'tower') return buildTowerRoom(spec, opts);
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
  /**
   * Ściana jako bryła z otworami (`holes` w metrach od środka ściany, `v` od jej dołu); `sx` wzdłuż X to ściana
   * przednia/tylna (u = x), `sz` wzdłuż Z to boczna (u = z). Kolider zostaje pudełkiem — okna są za wysoko, by przejść.
   */
  const wall = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, floorIndex: number, normal?: [number, number], holes: WallHole[] = []) => {
    const alongX = sx >= sz;
    const len = alongX ? sx : sz;
    const shifted = holes.map((hh) => ({ ...hh, v0: hh.v0 - sy / 2, v1: hh.v1 - sy / 2 }));
    const geo = scaleUv(wallGeometry(-len / 2, len / 2, -sy / 2, sy / 2, shifted, WALL_T), 1 / WALL_TILE, 1 / WALL_TILE);
    const mm = mesh(geo, m, x, y, z);
    if (!alongX) mm.rotation.y = -Math.PI / 2;
    g.add(mm);
    colliders.push({ size: [sx, sy, sz], pos: [x, y, z] });
    mm.userData.floorIndex = floorIndex;
    if (normal) {
      mm.userData.wallNormal = normal;
      walls.push(mm);
      for (const hh of holes) {
        const u = (hh.u0 + hh.u1) / 2;
        const wx = alongX ? x + u : x;
        const wz = alongX ? z : z + u;
        roomWindow(g, wx, y - sy / 2 + (hh.v0 + hh.v1) / 2, wz, Math.atan2(normal[0], normal[1]), hh.u1 - hh.u0, hh.v1 - hh.v0);
      }
    }
    return mm;
  };
  const shell = SHELLS[buildingType] ?? SHELLS.house;
  const winSize = roomWindowSize(h);
  const winsOn = (key: string) => roomWindowHoles(buildingType, key, key === 'left' || key === 'right' ? d / shell.inner.d : w / shell.inner.w, winSize);

  const wallMat = finishMat(opts.wallTexture, spec.wall, { roughness: 0.95 });
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
    wall(w, h, WALL_T, 0, y0 + h / 2, -d / 2, wallMat, k, [0, -1], winsOn('back')); // tylna
    wall(WALL_T, h, d, -w / 2, y0 + h / 2, 0, wallMat, k, [-1, 0], winsOn('left')); // lewa
    wall(WALL_T, h, d, w / 2, y0 + h / 2, 0, wallMat, k, [1, 0], winsOn('right')); // prawa
    if (k === 0) {
      // parter: przednia ściana z otworem drzwiowym (wyjście na zewnątrz); okna elewacji na kawałkach obok drzwi
      const sideW = (w - DOOR_W) / 2;
      const front = winsOn('front');
      const shift = (cx: number) => front.filter((hh) => hh.u0 > cx - sideW / 2 && hh.u1 < cx + sideW / 2).map((hh) => ({ ...hh, u0: hh.u0 - cx, u1: hh.u1 - cx }));
      wall(sideW, h, WALL_T, -(DOOR_W / 2 + sideW / 2), y0 + h / 2, d / 2, wallMat, k, [0, 1], shift(-(DOOR_W / 2 + sideW / 2)));
      wall(sideW, h, WALL_T, DOOR_W / 2 + sideW / 2, y0 + h / 2, d / 2, wallMat, k, [0, 1], shift(DOOR_W / 2 + sideW / 2));
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
      wall(w, h, WALL_T, 0, y0 + h / 2, d / 2, wallMat, k, [0, 1], winsOn('front')); // wyższe piętra: pełna ściana przednia
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
    trimeshes: [],
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

/**
 * Okrągły pokój wieży: mur z segmentów, stropy z ośmiokątnych pasów i wbudowane kręcone schody
 * wzdłuż muru — wieża ma być wieżą, nie prostokątnym pokojem, a schodów w niej nie da się dobrze
 * zbudować ręcznie.
 */
function buildTowerRoom(spec: RoomSpec, opts: RoomOpts): Room {
  const g = new THREE.Group();
  const R = Math.min(spec.width, spec.depth) / 2;
  const h = spec.height;
  const floors = Math.max(1, opts.floors);
  const colliders: RoomBox[] = [];
  const trimeshes: Trimesh[] = [];
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const mm = new THREE.Mesh(geo, m);
    mm.position.set(x, y, z);
    mm.castShadow = shadow;
    mm.receiveShadow = true;
    return mm;
  };
  const wallMat = finishMat(opts.wallTexture, spec.wall, { roughness: 0.95 });
  const floorMat = new THREE.MeshStandardMaterial({ color: spec.floor, roughness: 1 });
  const trimMat = mat('#c7c0ae', { roughness: 0.9 });
  const slabMat = mat('#e8e2d5', { roughness: 1 });

  const floor = mesh(new THREE.CylinderGeometry(R, R, SLAB_T, 24), floorMat, 0, -SLAB_T / 2, 0, false);
  floor.userData.ground = true;
  g.add(floor);
  colliders.push({ size: [2 * R, SLAB_T, 2 * R], pos: [0, -SLAB_T / 2, 0] });

  const walls: THREE.Mesh[] = [];
  const segments = 16;
  const side = 2 * R * Math.tan(Math.PI / segments);
  const doorW = Math.min(DOOR_W, side - 0.3);
  // okna elewacji wieży (segmenty muru bryły co 30°) trafiają do najbliższego z 16 segmentów pokoju
  const winSize = roomWindowSize(h);
  const winSegs = new Set((SHELL_WINDOWS.tower ?? []).map((x) => Math.round((Number(x.wall.slice(3)) * (360 / 12)) / (360 / segments)) % segments));
  const winHole = (): WallHole[] => [{ u0: -winSize.w / 2, u1: winSize.w / 2, v0: winSize.sill - h / 2, v1: winSize.sill + winSize.h - h / 2 }];
  let exitDoor!: THREE.Mesh;
  for (let k = 0; k < floors; k++) {
    const y0 = k * h;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R;
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const q: [number, number, number, number] = [quat.x, quat.y, quat.z, quat.w];
      // segment frontowy parteru: tylko nadproże, pod nim drzwi wyjściowe
      const lintel = k === 0 && i === 0;
      const sy = lintel ? h - DOOR_H : h;
      const cy = lintel ? y0 + DOOR_H + sy / 2 : y0 + h / 2;
      const hasWin = !lintel && winSegs.has(i);
      const geo = hasWin ? scaleUv(wallGeometry(-(side + 0.02) / 2, (side + 0.02) / 2, -sy / 2, sy / 2, winHole(), WALL_T), 1 / WALL_TILE, 1 / WALL_TILE) : scaleUv(new THREE.BoxGeometry(side + 0.02, sy, WALL_T), side / WALL_TILE, sy / WALL_TILE);
      const mm = mesh(geo, wallMat, x, cy, z);
      mm.rotation.y = a;
      mm.userData.floorIndex = k;
      mm.userData.wallNormal = [Math.sin(a), Math.cos(a)];
      walls.push(mm);
      g.add(mm);
      if (hasWin) roomWindow(g, x, y0 + winSize.sill + winSize.h / 2, z, a, winSize.w, winSize.h);
      colliders.push({ size: [side + 0.02, sy, WALL_T], pos: [x, cy, z], quat: q });
      if (lintel) {
        // słupki po bokach drzwi w tym samym segmencie
        const postW = (side + 0.02 - doorW) / 2;
        for (const sgn of [-1, 1]) {
          const px = x + Math.cos(a) * sgn * (doorW / 2 + postW / 2);
          const pz = z - Math.sin(a) * sgn * (doorW / 2 + postW / 2);
          const post = mesh(new THREE.BoxGeometry(postW, DOOR_H, WALL_T), wallMat, px, y0 + DOOR_H / 2, pz);
          post.rotation.y = a;
          post.userData.floorIndex = k;
          post.userData.wallNormal = [Math.sin(a), Math.cos(a)];
          walls.push(post);
          g.add(post);
          colliders.push({ size: [postW, DOOR_H, WALL_T], pos: [px, y0 + DOOR_H / 2, pz], quat: q });
        }
        g.add(mesh(new THREE.BoxGeometry(doorW + 0.24, DOOR_H + 0.12, 0.1), trimMat, 0, y0 + DOOR_H / 2, R - 0.02, true));
        g.add(mesh(new THREE.BoxGeometry(doorW, DOOR_H, 0.06), mat('#20302a'), 0, y0 + DOOR_H / 2, R - 0.06, false));
        const door = mesh(new THREE.BoxGeometry(0.72, DOOR_H - 0.12, 0.07), mat('#8b6a4f'), -doorW / 2 + 0.36, y0 + DOOR_H / 2 - 0.06, R - 0.28);
        door.rotation.y = -0.55;
        door.userData.exitDoor = true;
        door.userData.interactive = true;
        g.add(door);
        exitDoor = door;
      }
    }
  }

  // kręcone schody między kondygnacjami i stropy z otworem nad ich końcem
  const slabs: THREE.Object3D[] = [];
  const stairW = Math.min(1.3, R * 0.45);
  for (let k = 0; k < floors - 1; k++) {
    const { hole, ribbon } = spiralStairs(
      g,
      { cx: 0, cz: 0, r: R - WALL_T / 2 - 0.05, inner: R - WALL_T / 2 - 0.05 - stairW, y0: k * h, height: h, start: Math.PI / 2, turn: Math.PI * 1.5, steps: Math.max(10, Math.round(h / 0.2)) },
      mat('#d9d4c7'),
    );
    trimeshes.push(ribbon);
    const y = (k + 1) * h;
    let rects: Rect[] = discRects(R - WALL_T / 2 + 0.02);
    rects = subtractRect(rects, hole);
    for (const op of opts.openings[k] ?? []) rects = subtractRect(rects, { x0: op.cx - op.hx, x1: op.cx + op.hx, z0: op.cz - op.hz, z1: op.cz + op.hz });
    const slabGroup = new THREE.Group();
    for (const r of rects) {
      const sx = r.x1 - r.x0;
      const sz = r.z1 - r.z0;
      if (sx < 0.02 || sz < 0.02) continue;
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      slabGroup.add(mesh(new THREE.BoxGeometry(sx, SLAB_T, sz), slabMat, cx, y + SLAB_T / 2, cz, false));
      colliders.push({ size: [sx, SLAB_T, sz], pos: [cx, y + SLAB_T / 2, cz] });
    }
    g.add(slabGroup);
    slabs.push(slabGroup);
  }

  const topY = floors * h;
  const ceiling = mesh(new THREE.CylinderGeometry(R, R, SLAB_T, 24), slabMat, 0, topY + SLAB_T / 2, 0, false);
  g.add(ceiling);
  colliders.push({ size: [2 * R, SLAB_T, 2 * R], pos: [0, topY + SLAB_T / 2, 0] });

  return {
    group: g,
    ceiling,
    floor,
    exitDoor,
    walls,
    slabs,
    spawn: { pos: new THREE.Vector3(0, 0, R - 1.6), yaw: 0 },
    // kwadratowa granica na całą szerokość koła — mur zatrzymuje postać, a schody biegną przy nim
    bounds: { hx: R - WALL_T / 2 - 0.35, hz: R - WALL_T / 2 - 0.35 },
    colliders,
    trimeshes,
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
