import * as THREE from 'three';
import type { GroundSpec, Scenery } from '../types';
import { groundExtent, outsideDistance } from '../lib/ground';
import { sceneryPreset } from '../catalog';
import { Noise2D, smoothstep } from './noise';

export interface Terrain {
  group: THREE.Group;
  mesh: THREE.Mesh;
  water: THREE.Mesh | null;
  size: number; // długość boku pierścienia terenu
  /** Wysokość terenu w punkcie (interpolacja dwuliniowa). */
  heightAt(x: number, z: number): number;
  dispose(): void;
}

const SEG = 96;

/**
 * Pierścień krajobrazu wokół planszy: płaski tuż przy płycie, wznoszący się dalej.
 * Zwraca null dla scenerii 'none'.
 */
export function buildTerrain(ground: GroundSpec, scenery: Scenery, seed: number): Terrain | null {
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
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.position.y = -0.08;

  const group = new THREE.Group();
  group.add(mesh);

  let water: THREE.Mesh | null = null;
  if (preset.water !== null) {
    const wgeo = new THREE.PlaneGeometry(size, size);
    wgeo.rotateX(-Math.PI / 2);
    water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: '#a9d3e6', roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.86 }));
    water.position.y = preset.water;
    water.receiveShadow = false;
    group.add(water);
  }

  const heightAt = (x: number, z: number): number => {
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
