import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Modele z plików GLB (wierzchowce z Poly Pizza, licencja CC0). Wyjątek od zasady „wszystko proceduralne”:
 * plik ładuje się raz i trafia do cache, a każdy obiekt w scenie dostaje klon ze skopiowanym szkieletem —
 * geometrię i materiały klony dzielą, więc `disposeObject` ich nie zwalnia (`userData.sharedGeometry`).
 */
export interface Asset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Ramka modelu w pozie spoczynkowej, zmierzona z uwzględnieniem szkieletu. */
  bounds: THREE.Box3;
}

const cache = new Map<string, Asset>();
const pending = new Map<string, Promise<Asset>>();

function assetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/${file}`;
}

export function assetLoaded(file: string): Asset | undefined {
  return cache.get(file);
}

/** Ładuje plik raz; kolejne wywołania dostają tę samą obietnicę. */
export function loadAsset(file: string): Promise<Asset> {
  const ready = cache.get(file);
  if (ready) return Promise.resolve(ready);
  let p = pending.get(file);
  if (!p) {
    // loader idzie do osobnej paczki (jak Rapier): pałac bez wierzchowców z plików go nie potrzebuje
    p = import('three/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(assetUrl(file)))
      .then((gltf) => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        // skórowanie liczy się dopiero po `skeleton.update()`, inaczej ramka wyszłaby z macierzy zerowych
        scene.traverse((c) => {
          const s = c as THREE.SkinnedMesh;
          if (s.isSkinnedMesh) s.skeleton.update();
        });
        const bounds = new THREE.Box3().setFromObject(scene, true);
        const asset: Asset = { scene, clips: gltf.animations, bounds };
        cache.set(file, asset);
        pending.delete(file);
        return asset;
      });
    pending.set(file, p);
  }
  return p;
}

/** Klon do sceny: własny szkielet, wspólna geometria i materiały, cienie włączone. */
export function cloneAsset(asset: Asset): THREE.Object3D {
  const model = cloneSkeleton(asset.scene);
  model.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.sharedGeometry = true;
    m.userData.skipCollider = true; // bryłę daje niewidzialne pudło (skórowana siatka ma wierzchołki w układzie kości)
    m.frustumCulled = false; // ramka skórowanej siatki nie nadąża za animacją — na skraju kadru model by znikał
  });
  return model;
}

/** Klip po nazwie: pliki z Blendera mają nazwy z prefiksem armatury („AnimalArmature|Gallop”). */
export function findClip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip | undefined {
  return clips.find((c) => c.name === name) ?? clips.find((c) => c.name.endsWith(`|${name}`));
}
