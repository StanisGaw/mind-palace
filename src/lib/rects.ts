/** Prostokąt w rzucie z góry (osiowy). Wspólny dla stropów, płyty świata i fizyki. */
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

/** Odległość punktu od prostokąta (0 w środku). */
export function rectDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/** Najbliższy punkt wewnątrz prostokąta, z marginesem od krawędzi (margines nie zjada więcej niż połowę boku). */
export function clampToRect(r: Rect, x: number, z: number, margin = 0): [number, number] {
  const mx = Math.min(margin, (r.x1 - r.x0) / 2);
  const mz = Math.min(margin, (r.z1 - r.z0) / 2);
  return [Math.min(r.x1 - mx, Math.max(r.x0 + mx, x)), Math.min(r.z1 - mz, Math.max(r.z0 + mz, z))];
}

/**
 * Kafle siatki scalone w możliwie duże prostokąty: najpierw poziome pasy w każdym wierszu, potem sklejanie
 * pasów o tym samym zakresie X w sąsiednich wierszach. Mniej prostokątów to mniej koliderów i mniej szwów.
 */
export function mergeTiles(tiles: [number, number][], size: number): Rect[] {
  const rows = new Map<number, number[]>();
  const seen = new Set<string>();
  for (const [i, j] of tiles) {
    const key = `${i},${j}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = rows.get(j) ?? [];
    row.push(i);
    rows.set(j, row);
  }
  // pasy w wierszu: ciągi sąsiednich kafli
  type Strip = { i0: number; i1: number; j: number };
  const strips: Strip[] = [];
  for (const [j, list] of rows) {
    list.sort((a, b) => a - b);
    let start = list[0];
    let prev = list[0];
    for (let k = 1; k <= list.length; k++) {
      const cur = list[k];
      if (cur !== prev + 1) {
        strips.push({ i0: start, i1: prev, j });
        start = cur;
      }
      prev = cur;
    }
  }
  strips.sort((a, b) => a.i0 - b.i0 || a.i1 - b.i1 || a.j - b.j);
  const used = new Array(strips.length).fill(false);
  const out: Rect[] = [];
  for (let k = 0; k < strips.length; k++) {
    if (used[k]) continue;
    const s = strips[k];
    let jEnd = s.j;
    for (let m = k + 1; m < strips.length; m++) {
      if (used[m] || strips[m].i0 !== s.i0 || strips[m].i1 !== s.i1 || strips[m].j !== jEnd + 1) continue;
      used[m] = true;
      jEnd = strips[m].j;
    }
    out.push({ x0: s.i0 * size, x1: (s.i1 + 1) * size, z0: s.j * size, z1: (jEnd + 1) * size });
  }
  return out;
}

/**
 * Obrysy zewnętrzne zbioru kafli: krawędzie należące do dokładnie jednego kafla, obejście po sąsiadach.
 * Może zwrócić kilka pierścieni (rozłączne wyspy i dziury) — wynik jest przeciwnie do wskazówek zegara
 * dla pola i zgodnie z nimi dla dziur, jak wymaga `THREE.Shape`.
 */
export function tileOutlines(tiles: [number, number][], size: number): [number, number][][] {
  const has = new Set(tiles.map(([i, j]) => `${i},${j}`));
  // każda krawędź kafla bez sąsiada po drugiej stronie; kierunek tak, by pole zostawało po lewej
  const edges = new Map<string, [number, number]>();
  const key = (x: number, z: number) => `${x},${z}`;
  for (const [i, j] of tiles) {
    const x0 = i * size;
    const x1 = (i + 1) * size;
    const z0 = j * size;
    const z1 = (j + 1) * size;
    if (!has.has(`${i},${j - 1}`)) edges.set(key(x0, z0), [x1, z0]);
    if (!has.has(`${i + 1},${j}`)) edges.set(key(x1, z0), [x1, z1]);
    if (!has.has(`${i},${j + 1}`)) edges.set(key(x1, z1), [x0, z1]);
    if (!has.has(`${i - 1},${j}`)) edges.set(key(x0, z1), [x0, z0]);
  }
  const out: [number, number][][] = [];
  while (edges.size > 0) {
    const first = edges.keys().next().value as string;
    const ring: [number, number][] = [];
    let cur = first;
    while (edges.has(cur)) {
      const next = edges.get(cur)!;
      edges.delete(cur);
      ring.push(next);
      cur = key(next[0], next[1]);
    }
    if (ring.length >= 4) out.push(ring);
  }
  return out;
}
