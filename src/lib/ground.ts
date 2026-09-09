import type { GroundShape, GroundSpec } from '../types';
import { clampToRect, mergeTiles, rectDistance, tileOutlines, type Rect } from './rects';

/** Bok kafla narysowanej planszy w metrach. */
export const GROUND_TILE = 4;

/** Czy plansza jest narysowana kaflami (wtedy `shape` i wymiary nie mają znaczenia). */
export function isDrawnGround(g: GroundSpec): boolean {
  return !!g.tiles && g.tiles.length > 0;
}

/**
 * Płyta jako prostokąty: narysowana plansza po scaleniu kafli, prostokątna jako jeden, koło i sześciokąt
 * jako poziome pasy. Pasy służą tylko kolizji i wycinaniu otworów — obrys do rysowania zostaje wielokątem.
 */
export function groundRects(g: GroundSpec): Rect[] {
  if (isDrawnGround(g)) return mergeTiles(g.tiles!, GROUND_TILE);
  if (g.shape === 'rect') return [{ x0: -g.width / 2, x1: g.width / 2, z0: -g.depth / 2, z1: g.depth / 2 }];
  return convexStrips(groundPolygon(g), 1);
}

/** Wielokąt wypukły pocięty na poziome pasy o wysokości `step` — przybliżenie do koliderów pudełkowych. */
function convexStrips(poly: [number, number][], step: number): Rect[] {
  const zs = poly.map(([, z]) => z);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const out: Rect[] = [];
  for (let z = z0; z < z1 - 1e-6; z += step) {
    const zb = Math.min(z + step, z1);
    // pas bierzemy po węższym z dwóch brzegów, żeby nie wystawał poza obrys
    let lo = Infinity;
    let hi = -Infinity;
    for (const zz of [z, zb]) {
      let a = Infinity;
      let b = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        if ((p[1] - zz) * (q[1] - zz) > 0) continue;
        if (p[1] === q[1]) continue;
        const t = (zz - p[1]) / (q[1] - p[1]);
        const x = p[0] + (q[0] - p[0]) * t;
        a = Math.min(a, x);
        b = Math.max(b, x);
      }
      lo = Math.min(lo, a === Infinity ? 0 : a);
      hi = Math.max(hi, b === -Infinity ? 0 : b);
      if (zz === z) {
        lo = a === Infinity ? 0 : a;
        hi = b === -Infinity ? 0 : b;
      } else {
        lo = Math.max(lo, a === Infinity ? lo : a);
        hi = Math.min(hi, b === -Infinity ? hi : b);
      }
    }
    if (hi - lo > 0.01) out.push({ x0: lo, x1: hi, z0: z, z1: zb });
  }
  return out;
}

/** Obrys planszy do rysowania: dla kafli może być wklęsły i wieloczęściowy, inaczej jeden wielokąt wypukły. */
export function groundOutlines(g: GroundSpec): [number, number][][] {
  return isDrawnGround(g) ? tileOutlines(g.tiles!, GROUND_TILE) : [groundPolygon(g)];
}

/** Prostokąt opisany na planszy (środek i połowy boków) — kadr kamery, cieni i mgły. */
export function groundBounds(g: GroundSpec): Rect {
  const rects = isDrawnGround(g) ? groundRects(g) : null;
  if (!rects || rects.length === 0) return { x0: -g.width / 2, x1: g.width / 2, z0: -g.depth / 2, z1: g.depth / 2 };
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    z0: Math.min(...rects.map((r) => r.z0)),
    z1: Math.max(...rects.map((r) => r.z1)),
  };
}

/** Największy wymiar planszy — do kadrowania kamery, mgły i cieni. */
export function groundExtent(g: GroundSpec): number {
  if (!isDrawnGround(g)) return Math.max(g.width, g.depth);
  const b = groundBounds(g);
  return Math.max(b.x1 - b.x0, b.z1 - b.z0);
}

/** Kafel, w którym leży punkt. */
export function tileAt(x: number, z: number): [number, number] {
  return [Math.floor(x / GROUND_TILE), Math.floor(z / GROUND_TILE)];
}

/** Bieżący kształt planszy przepisany na kafle — punkt wyjścia przy pierwszym rysowaniu. */
export function tilesFromShape(g: GroundSpec): [number, number][] {
  const half = Math.ceil(Math.max(g.width, g.depth) / GROUND_TILE) + 1;
  const out: [number, number][] = [];
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      // kafel należy do planszy, gdy jego środek leży w obrysie
      if (insideGround(g, (i + 0.5) * GROUND_TILE, (j + 0.5) * GROUND_TILE)) out.push([i, j]);
    }
  }
  return out;
}

/** Obrys planszy w rzucie z góry (wielokąt wypukły, przeciwnie do wskazówek zegara). */
export function groundPolygon(g: GroundSpec): [number, number][] {
  const hx = g.width / 2;
  const hz = g.depth / 2;
  if (g.shape === 'rect') {
    return [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ];
  }
  const r = g.width / 2;
  const n = g.shape === 'hex' ? 6 : 48;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (g.shape === 'hex' ? Math.PI / 6 : 0);
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Ile trzeba odsunąć się od krawędzi planszy (0 wewnątrz). */
export function outsideDistance(g: GroundSpec, x: number, z: number): number {
  if (isDrawnGround(g)) {
    const rects = groundRects(g);
    return rects.length ? Math.min(...rects.map((r) => rectDistance(r, x, z))) : 0;
  }
  if (g.shape === 'rect') return Math.max(Math.abs(x) - g.width / 2, Math.abs(z) - g.depth / 2, 0);
  const r = g.width / 2;
  if (g.shape === 'circle') return Math.max(Math.hypot(x, z) - r, 0);
  // sześciokąt: największe przekroczenie którejkolwiek z sześciu półpłaszczyzn
  const apothem = r * Math.cos(Math.PI / 6);
  let d = 0;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    d = Math.max(d, x * Math.cos(a) + z * Math.sin(a) - apothem);
  }
  return Math.max(d, 0);
}

export function insideGround(g: GroundSpec, x: number, z: number): boolean {
  return outsideDistance(g, x, z) <= 0;
}

/** Najbliższy punkt wewnątrz planszy, z zadanym marginesem od krawędzi. */
export function clampToGround(g: GroundSpec, x: number, z: number, margin = 0.4): [number, number] {
  if (isDrawnGround(g)) {
    const rects = groundRects(g);
    if (rects.length === 0) return [x, z];
    // najbliższy punkt w którymkolwiek prostokącie; margines liczymy dopiero po wyborze, żeby nie odrzucić wąskiego pasa
    let best: [number, number] = clampToRect(rects[0], x, z, margin);
    let bestD = Math.hypot(best[0] - x, best[1] - z);
    for (const r of rects.slice(1)) {
      const p = clampToRect(r, x, z, margin);
      const d = Math.hypot(p[0] - x, p[1] - z);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }
  if (g.shape === 'rect') {
    const hx = Math.max(g.width / 2 - margin, 0.5);
    const hz = Math.max(g.depth / 2 - margin, 0.5);
    return [Math.min(hx, Math.max(-hx, x)), Math.min(hz, Math.max(-hz, z))];
  }
  const r = Math.max(g.width / 2 - margin, 0.5);
  if (g.shape === 'circle') {
    const d = Math.hypot(x, z);
    if (d <= r) return [x, z];
    const k = r / (d || 1);
    return [x * k, z * k];
  }
  // sześciokąt: kilka rzutów na przekroczone półpłaszczyzny wystarcza dla wielokąta wypukłego
  const apothem = r * Math.cos(Math.PI / 6);
  let px = x;
  let pz = z;
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const over = px * nx + pz * nz - apothem;
      if (over > 0) {
        px -= nx * over;
        pz -= nz * over;
      }
    }
  }
  return [px, pz];
}

/** Przycięcie odcinka do wielokąta wypukłego (algorytm Cyrusa–Becka). Null, gdy odcinek jest poza. */
export function clipSegment(
  a: [number, number],
  b: [number, number],
  poly: [number, number][],
): [[number, number], [number, number]] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    // normalna skierowana na zewnątrz dla obrysu przeciwnego do wskazówek zegara
    const nx = q[1] - p[1];
    const nz = -(q[0] - p[0]);
    const den = dx * nx + dz * nz;
    const num = (a[0] - p[0]) * nx + (a[1] - p[1]) * nz;
    if (Math.abs(den) < 1e-9) {
      if (num > 0) return null; // równolegle i na zewnątrz
      continue;
    }
    const t = -num / den;
    if (den > 0) t1 = Math.min(t1, t);
    else t0 = Math.max(t0, t);
    if (t0 > t1) return null;
  }
  return [
    [a[0] + dx * t0, a[1] + dz * t0],
    [a[0] + dx * t1, a[1] + dz * t1],
  ];
}

export const GROUND_SHAPES: { id: GroundShape; name: string }[] = [
  { id: 'rect', name: 'Prostokąt' },
  { id: 'circle', name: 'Koło' },
  { id: 'hex', name: 'Sześciokąt' },
];
