import type { GroundShape, GroundSpec } from '../types';

/** Największy wymiar planszy — do kadrowania kamery, mgły i cieni. */
export function groundExtent(g: GroundSpec): number {
  return Math.max(g.width, g.depth);
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
