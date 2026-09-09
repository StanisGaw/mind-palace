import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Oznaczenia, po których scena odnajduje pojedynczą siatkę i rusza nią osobno (skrzydło drzwi, dach,
 * strop, ściana chowana przed kamerą, części wierzchowców `rig` — śmigło, skrzydła, nogi, segmenty —
 * końcówka ścieżki, szyba z własnym materiałem). Siatka
 * z którymkolwiek z nich zostaje sobą; reszta może się scalić.
 */
const KEEP_APART = new Set(['doorLeaf', 'rig', 'roof', 'slab', 'wallNormal', 'floorIndex', 'pathCap', 'ownMaterial', 'noPick', 'interactive', 'exitDoor', 'ground']);

function separate(o: THREE.Object3D): boolean {
  for (const key of Object.keys(o.userData)) if (KEEP_APART.has(key)) return true;
  return false;
}

/** Oznaczenia, które muszą się zgadzać w scalanej grupie, bo ktoś je jeszcze czyta (`skipCollider`, `floorSurface`). */
function flags(o: THREE.Object3D): string {
  return Object.entries(o.userData)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort()
    .join(',');
}

interface Candidate {
  mesh: THREE.Mesh;
  /** Przekształcenie siatki względem kontenera, do wpieczenia w geometrię. */
  matrix: THREE.Matrix4;
}

/** Zbiera siatki nadające się do scalenia z całego poddrzewa, wchodząc też w zwykłe podgrupy. */
function collect(node: THREE.Object3D, parentMatrix: THREE.Matrix4, out: Candidate[], nested: THREE.Object3D[]) {
  for (const child of node.children) {
    child.updateMatrix();
    const matrix = parentMatrix.clone().multiply(child.matrix);
    const m = child as THREE.Mesh;
    if (separate(child)) {
      nested.push(child);
      continue;
    }
    if (m.isMesh && m.children.length === 0 && !Array.isArray(m.material) && m.geometry && Object.keys(m.geometry.morphAttributes).length === 0) {
      out.push({ mesh: m, matrix });
      continue;
    }
    if (!m.isMesh && child.children.length > 0) collect(child, matrix, out, nested);
  }
}

/**
 * Scala siatki modelu o wspólnym materiale w jedną. Każda siatka to osobne wywołanie rysowania, a jeden
 * domek składa się z siedemdziesięciu — na planszy pełnej budynków to główny koszt klatki po stronie
 * procesora. Materiały w `builders.ts` są współdzielone (cache w `mat()`), więc z modelu zostaje mniej
 * więcej tyle siatek, ile ma on różnych materiałów.
 *
 * Przekształcenia podgrup wpiekamy w geometrię, więc model po scaleniu jest płaski. Poddrzewa, którymi scena
 * rusza osobno (patrz `KEEP_APART`), zostają nietknięte i scalają się osobno — dzięki temu skrzydło drzwi
 * dalej się obraca, a dach i ściany dalej znikają przed kamerą. Geometrie źródłowe powstają na nowo przy
 * każdej budowie modelu i nie są nigdzie zapamiętane, więc po scaleniu zwalniamy je od razu.
 *
 * Wołane przed nadaniem siatkom `userData.objectId` — potem żadna nie miałaby czystego `userData`.
 */
export function mergeByMaterial(root: THREE.Object3D) {
  const candidates: Candidate[] = [];
  const nested: THREE.Object3D[] = [];
  collect(root, new THREE.Matrix4(), candidates, nested);

  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const geo = c.mesh.geometry;
    // materiał, cienie, widoczność, oznaczenia i układ atrybutów muszą się zgadzać
    const key = [
      (c.mesh.material as THREE.Material).uuid,
      c.mesh.castShadow,
      c.mesh.receiveShadow,
      c.mesh.visible,
      flags(c.mesh),
      geo.index ? 'i' : 'n',
      Object.keys(geo.attributes).sort().join('+'),
    ].join('|');
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const moved = list.map((c) => c.mesh.geometry.clone().applyMatrix4(c.matrix));
    const merged = mergeGeometries(moved, false);
    for (const g of moved) g.dispose();
    if (!merged) continue;
    const first = list[0].mesh;
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.visible = first.visible;
    mesh.userData = { ...first.userData };
    for (const c of list) {
      c.mesh.removeFromParent();
      c.mesh.geometry.dispose();
    }
    root.add(mesh);
  }

  // siatki, które nie miały z czym się scalić, też przenosimy do korzenia z wpieczonym przekształceniem:
  // po scaleniu model jest płaski, więc nikt nie polega na tym, w której podgrupie coś leżało
  for (const c of candidates) {
    if (!c.mesh.parent || c.mesh.parent === root) continue;
    c.mesh.geometry.applyMatrix4(c.matrix);
    c.mesh.position.set(0, 0, 0);
    c.mesh.rotation.set(0, 0, 0);
    c.mesh.scale.set(1, 1, 1);
    root.add(c.mesh);
  }

  for (const child of nested) mergeByMaterial(child);
}
