import * as THREE from 'three';
import type { Weather } from '../types';
import { AMBIENCES } from '../catalog';
import { PointsEmitter, type Updatable } from './particles';

interface CloudCfg {
  color: string;
  count: number; // liczba chmur
}

const CLOUDS: Partial<Record<Weather, CloudCfg>> = {
  clear: { color: '#ffffff', count: 6 },
  cloudy: { color: '#f4f4f4', count: 16 },
  rain: { color: '#a8adb5', count: 18 },
  storm: { color: '#8e939b', count: 20 },
  snow: { color: '#eef1f4', count: 14 },
  fog: { color: '#e6e6e4', count: 8 },
};

const LIGHT_FACTOR: Record<Weather, number> = {
  clear: 1,
  cloudy: 0.72,
  rain: 0.55,
  snow: 0.82,
  fog: 0.7,
  storm: 0.42,
};

const cloudGeo = new THREE.SphereGeometry(1, 10, 7);

/** Chmury, opady, mgła i błyskawice. Jeden system na scenę. */
export class WeatherSystem {
  private scene: THREE.Scene;
  private clouds: THREE.InstancedMesh | null = null;
  private cloudDrift: Float32Array = new Float32Array(0);
  private cloudBase: Float32Array = new Float32Array(0); // x,y,z,scale na instancję
  private cloudSpan = 100;
  private precip: Updatable | null = null;
  private weather: Weather = 'clear';
  private enabled = true;
  private t = 0;
  private nextFlash = 6;
  private flashT = 0;

  /** Mnożnik jasności świateł wynikający z pogody. */
  lightFactor = 1;
  /** Mgła narzucona przez pogodę (albo null, gdy decyduje klimat). */
  fog: { color: string; near: number; far: number } | null = null;
  /** Chwilowy dodatek jasności (błyskawica), 0..1. */
  flash = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  apply(weather: Weather, ambienceId: string, groundSize: number, enabled: boolean) {
    this.weather = weather;
    this.enabled = enabled;
    this.clearObjects();
    this.lightFactor = enabled ? LIGHT_FACTOR[weather] ?? 1 : 1;
    this.fog = null;
    this.flash = 0;
    if (!enabled) return;

    const amb = AMBIENCES.find((a) => a.id === ambienceId) ?? AMBIENCES[0];
    const night = ambienceId === 'night';

    if (weather === 'fog') {
      this.fog = { color: amb.fog, near: 4, far: Math.max(28, groundSize * 1.4) };
    }

    // chmury
    const cfg = CLOUDS[weather];
    if (cfg && cfg.count > 0) {
      const blobs = 5;
      const total = cfg.count * blobs;
      const color = night ? '#5c6270' : cfg.color;
      // MeshBasicMaterial: chmura ma być płaską, jasną sylwetką, a nie bryłą cieniowaną od spodu
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: night ? 0.7 : 0.9, fog: true });
      const mesh = new THREE.InstancedMesh(cloudGeo, mat, total);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.cloudSpan = Math.max(90, groundSize * 4);
      this.cloudBase = new Float32Array(total * 4);
      this.cloudDrift = new Float32Array(cfg.count);
      const m = new THREE.Matrix4();
      const v = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      let i = 0;
      for (let c = 0; c < cfg.count; c++) {
        const cx = (Math.random() - 0.5) * this.cloudSpan;
        const cy = 26 + Math.random() * 10;
        const cz = (Math.random() - 0.5) * this.cloudSpan;
        this.cloudDrift[c] = 0.35 + Math.random() * 0.5;
        for (let b = 0; b < blobs; b++) {
          const bx = cx + (Math.random() - 0.5) * 12;
          const by = cy + (Math.random() - 0.5) * 2.2;
          const bz = cz + (Math.random() - 0.5) * 9;
          const sc = 2.8 + Math.random() * 3.4;
          this.cloudBase[i * 4] = bx;
          this.cloudBase[i * 4 + 1] = by;
          this.cloudBase[i * 4 + 2] = bz;
          this.cloudBase[i * 4 + 3] = sc;
          v.set(bx, by, bz);
          s.set(sc, sc * 0.62, sc);
          m.compose(v, q, s);
          mesh.setMatrixAt(i, m);
          i++;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.clouds = mesh;
      this.scene.add(mesh);
    }

    // opady
    if (weather === 'rain' || weather === 'storm') {
      this.precip = new PointsEmitter({ count: weather === 'storm' ? 2400 : 1700, box: { x: 34, y: 20, z: 34 }, color: night ? '#9db4d2' : '#aec1d6', size: 0.55, fall: 15, opacity: 0.6, shape: 'drop' });
      this.scene.add(this.precip.object);
    } else if (weather === 'snow') {
      this.precip = new PointsEmitter({ count: 1300, box: { x: 34, y: 20, z: 34 }, color: '#ffffff', size: 0.2, fall: 1.3, sway: 0.7, opacity: 0.95, shape: 'flake' });
      this.scene.add(this.precip.object);
    }
  }

  update(dt: number, camPos: THREE.Vector3) {
    if (!this.enabled) return;
    this.t += dt;
    if (this.clouds) {
      const m = new THREE.Matrix4();
      const v = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const half = this.cloudSpan / 2;
      const blobs = 5;
      for (let i = 0; i < this.clouds.count; i++) {
        const c = Math.floor(i / blobs);
        let x = this.cloudBase[i * 4] + this.cloudDrift[c] * this.t;
        // owijanie w poziomie
        x = ((((x + half) % this.cloudSpan) + this.cloudSpan) % this.cloudSpan) - half;
        const y = this.cloudBase[i * 4 + 1];
        const z = this.cloudBase[i * 4 + 2];
        const sc = this.cloudBase[i * 4 + 3];
        v.set(x, y, z);
        s.set(sc, sc * 0.62, sc);
        m.compose(v, q, s);
        this.clouds.setMatrixAt(i, m);
      }
      this.clouds.instanceMatrix.needsUpdate = true;
    }
    this.precip?.update(dt, camPos);
    // błyskawice
    if (this.weather === 'storm') {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flashT = 0.28;
        this.nextFlash = 4 + Math.random() * 6;
      }
      if (this.flashT > 0) {
        this.flashT -= dt;
        this.flash = Math.max(0, this.flashT / 0.28);
      } else this.flash = 0;
    } else this.flash = 0;
  }

  private clearObjects() {
    if (this.clouds) {
      this.scene.remove(this.clouds);
      (this.clouds.material as THREE.Material).dispose();
      this.clouds.dispose();
      this.clouds = null;
    }
    if (this.precip) {
      this.scene.remove(this.precip.object);
      this.precip.dispose();
      this.precip = null;
    }
  }

  /** W rzucie z góry chmury zasłoniłyby planszę — chowamy je. */
  setCloudsVisible(v: boolean) {
    if (this.clouds) this.clouds.visible = v;
  }

  dispose() {
    this.clearObjects();
  }
}
