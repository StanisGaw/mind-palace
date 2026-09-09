import * as THREE from 'three';
import type { GroundSpec, Scenery } from '../types';
import { groundExtent, outsideDistance } from '../lib/ground';
import { pointInPolygon } from '../lib/rects';
import { sceneryPreset } from '../catalog';
import { Noise2D, smoothstep } from './noise';

export interface Terrain {
  group: THREE.Group;
  mesh: THREE.Mesh;
  water: THREE.Mesh | null;
  size: number; // długość boku pierścienia terenu
  /** Wysokość terenu w punkcie (interpolacja dwuliniowa). Nie zna wycięć — pyta o ukształtowanie, nie o siatkę. */
  heightAt(x: number, z: number): number;
  /** Podmienia otwory (piwnice) bez liczenia szumu od nowa: przelicza sam indeks siatki i taflę wody. */
  setHoles(holes: [number, number][][]): void;
  dispose(): void;
}

const SEG = 96;

/**
 * Pierścień krajobrazu wokół planszy: płaski tuż przy płycie, wznoszący się dalej.
 * Zwraca null dla scenerii 'none'. `holes` to obrysy wnętrz budynków z piwnicą: teren leży kilkanaście
 * centymetrów pod zerem, czyli w środku takiej piwnicy, i bez tego zamykałby ją niewidzialną pokrywą (jest
 * też bryłą kolizji). Zamiast wycinać trójkąty — bo przy oczku ok. 2 m przy ścianach zostawały resztki,
 * akurat tam, gdzie stoją schody — wtapiamy wierzchołki głęboko pod ziemię. Siatka zostaje ciągła, więc
 * nigdzie nie ma dziury, przez którą dałoby się spaść.
 */
export function buildTerrain(ground: GroundSpec, scenery: Scenery, seed: number, holes: [number, number][][] = []): Terrain | null {
  if (scenery === 'none') return null;
  const preset = sceneryPreset(scenery);
  const groundSize = groundExtent(ground);
  const size = Math.max(groundSize * 5, 120);
  const noise = new Noise2D(seed);
  const half = size / 2;
  const step = size / SEG;

  // maska: 0 przy planszy (płasko), 1 daleko od niej
  const blend = Math.max(groundSize * 1.5, 20);
  const heights = new Float32Array((SEG + 1) * (SEG + 1));

  const heightRaw = (x: number, z: number) => {
    const d = outsideDistance(ground, x, z);
    const k = smoothstep(1.5, 1.5 + blend, d);
    if (k <= 0) return -0.05;
    const nx = x * preset.freq;
    const nz = z * preset.freq;
    let h = preset.ridge ? noise.ridged(nx, nz, preset.octaves) * preset.amp : noise.fbm(nx, nz, preset.octaves) * preset.amp;
    if (preset.ridge) {
      // góry rosną wraz z oddaleniem od planszy
      h *= 0.25 + 0.75 * k;
      h -= preset.amp * 0.12;
    }
    if (preset.slopeX) h -= (x / half) * preset.amp * 1.4 * preset.slopeX;
    return -0.05 + (h + 0.05) * k;
  };

  for (let j = 0; j <= SEG; j++) {
    for (let i = 0; i <= SEG; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      heights[j * (SEG + 1) + i] = heightRaw(x, z);
    }
  }

  const geo = new THREE.PlaneGeometry(size, size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const palette = preset.palette;
  for (let idx = 0; idx < pos.count; idx++) {
    // PlaneGeometry po obrocie: wiersze wzdłuż X, kolumny wzdłuż Z
    const i = idx % (SEG + 1);
    const j = Math.floor(idx / (SEG + 1));
    const h = heights[j * (SEG + 1) + i];
    pos.setY(idx, h);
    let c = palette[0].color;
    for (const p of palette) if (h >= p.h) c = p.color;
    col.set(c);
    // delikatne zróżnicowanie odcienia
    const t = 0.94 + ((i * 7 + j * 13) % 11) * 0.011;
    colors[idx * 3] = col.r * t;
    colors[idx * 3 + 1] = col.g * t;
    colors[idx * 3 + 2] = col.b * t;
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // zapas półtora oczka: trójkąt dotykający obrysu ma wtedy wszystkie wierzchołki wtopione, więc żaden
  // jego skrawek nie zostaje w piwnicy
  const margin = step * 1.5;
  const applyHoles = (list: [number, number][][]) => {
    for (let idx = 0; idx < pos.count; idx++) {
      const i = idx % (SEG + 1);
      const j = Math.floor(idx / (SEG + 1));
      const x = -half + i * step;
      const z = -half + j * step;
      pos.setY(idx, inHole(list, x, z, margin) ? SUNK_Y : heights[j * (SEG + 1) + i]);
    }
    pos.needsUpdate = true;
  };
  let holeList = holes;
  if (holes.length > 0) applyHoles(holes);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.position.y = -0.08;

  const group = new THREE.Group();
  group.add(mesh);

  let waterY: number | null = preset.water;
  let water: THREE.Mesh | null = null;
  if (preset.water !== null) {
    // tafla wody sięga tak samo daleko jak teren, więc bez wycięcia zamykałaby piwnicę od góry
    // (przy scenerii „wybrzeże" leży 0,9 m pod zerem). Kształt z dziurami tnie ją dokładnie, bez oczek siatki.
    const wgeo = new THREE.ShapeGeometry(waterShape(size, holes));
    wgeo.rotateX(-Math.PI / 2);
    water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: '#a9d3e6', roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.86 }));
    water.position.y = preset.water;
    water.receiveShadow = false;
    group.add(water);
  }

  const heightAt = (x: number, z: number): number => {
    if (inHole(holeList, x, z, step * 1.5)) return SUNK_Y - 0.08; // pod piwnicą nie ma po czym chodzić
    const fx = (x + half) / step;
    const fz = (z + half) / step;
    if (fx < 0 || fz < 0 || fx > SEG || fz > SEG) return -0.05;
    const i = Math.min(SEG - 1, Math.floor(fx));
    const j = Math.min(SEG - 1, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const h00 = heights[j * (SEG + 1) + i];
    const h10 = heights[j * (SEG + 1) + i + 1];
    const h01 = heights[(j + 1) * (SEG + 1) + i];
    const h11 = heights[(j + 1) * (SEG + 1) + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz - 0.08;
  };

  return {
    group,
    mesh,
    water,
    size,
    heightAt,
    setHoles(next) {
      holeList = next;
      applyHoles(next);
      geo.computeVertexNormals();
      if (!water || waterY === null) return;
      water.geometry.dispose();
      water.geometry = new THREE.ShapeGeometry(waterShape(size, next));
      water.geometry.rotateX(-Math.PI / 2);
    },
    dispose() {
      geo.dispose();
      (mesh.material as THREE.Material).dispose();
      if (water) {
        water.geometry.dispose();
        (water.material as THREE.Material).dispose();
      }
      group.removeFromParent();
    },
  };
}

/** Głębokość, na którą chowa się teren pod piwnicą — niżej niż najgłębsza możliwa podłoga poziomu −1. */
const SUNK_Y = -12;

/** Czy punkt leży w którymś z obrysów albo bliżej niż `margin` od jego krawędzi. */
function inHole(holes: [number, number][][], x: number, z: number, margin: number): boolean {
  for (const h of holes) {
    if (pointInPolygon(h, x, z)) return true;
    for (let i = 0; i < h.length; i++) {
      if (segmentDistance(h[i], h[(i + 1) % h.length], x, z) < margin) return true;
    }
  }
  return false;
}

/** Odległość punktu od odcinka. */
function segmentDistance(a: [number, number], b: [number, number], x: number, z: number): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2)) : 0;
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

/**
 * Kwadrat tafli wody z otworami piwnic. Druga współrzędna idzie z odwrotnym znakiem, bo obrót o −90°
 * wokół X odwzorowuje ją na świat jako −y — bez tego dziura wypadłaby po przeciwnej stronie sceny.
 */
function waterShape(size: number, holes: [number, number][][]): THREE.Shape {
  const h = size / 2;
  const shape = new THREE.Shape([
    new THREE.Vector2(-h, -h),
    new THREE.Vector2(h, -h),
    new THREE.Vector2(h, h),
    new THREE.Vector2(-h, h),
  ]);
  for (const ring of holes) {
    shape.holes.push(new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
  }
  return shape;
}
