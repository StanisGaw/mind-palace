/**
 * Przeszkody w poziomie dla zwierząt i wierzchowców: obrys obiektu jako prostokąt obrócony o `yaw`
 * (osie X/Z modelu), z podłogą i szczytem, żeby lot nad dachem nie liczył się jako zderzenie.
 * Czysta geometria — scena buduje listę z wpisów, a tu tylko liczymy odległości i wypychanie.
 */
export interface Obstacle {
  id: string;
  x: number;
  z: number;
  yaw: number;
  hx: number; // połowa szerokości wzdłuż lokalnego X
  hz: number; // połowa głębokości wzdłuż lokalnego Z
  bottom: number;
  top: number;
}

export interface Contact {
  /** Odległość od brzegu w poziomie; ujemna wewnątrz (o tyle trzeba wypchnąć). */
  dist: number;
  /** Kierunek na zewnątrz (jednostkowy, w świecie). */
  nx: number;
  nz: number;
}

/** Odległość punktu od brzegu przeszkody i kierunek, w którym najbliżej na zewnątrz. */
export function contact(o: Obstacle, x: number, z: number): Contact {
  const dx = x - o.x;
  const dz = z - o.z;
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  // do układu obiektu: obrót o −yaw (obrót wokół Y w Three: x' = x·cos + z·sin, z' = −x·sin + z·cos)
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ex = Math.abs(lx) - o.hx;
  const ez = Math.abs(lz) - o.hz;
  let nlx: number;
  let nlz: number;
  let dist: number;
  if (ex > 0 || ez > 0) {
    const ox = Math.max(ex, 0);
    const oz = Math.max(ez, 0);
    dist = Math.hypot(ox, oz);
    nlx = ox > 0 ? (Math.sign(lx) * ox) / dist : 0;
    nlz = oz > 0 ? (Math.sign(lz) * oz) / dist : 0;
  } else if (ex > ez) {
    // wewnątrz: wychodzimy przez bliższą ścianę
    dist = ex;
    nlx = lx >= 0 ? 1 : -1;
    nlz = 0;
  } else {
    dist = ez;
    nlx = 0;
    nlz = lz >= 0 ? 1 : -1;
  }
  return { dist, nx: nlx * c + nlz * s, nz: -nlx * s + nlz * c };
}

/** Czy przeszkoda liczy się na wysokości `y`: nad szczytem i głęboko pod podłogą przelatuje się swobodnie. */
function blocksAt(o: Obstacle, y: number | undefined): boolean {
  if (y === undefined) return true;
  return y < o.top && y + 1.5 > o.bottom;
}

/**
 * Wypycha punkt poza przeszkody z marginesem (promień poruszającego się). Zwraca też, o co się otarł,
 * żeby jeździec mógł się zatrzymać, a zwierzę zmienić kierunek.
 */
export function pushOut(x: number, z: number, obstacles: Obstacle[], margin: number, y?: number, ignoreId?: string): { x: number; z: number; hit: Obstacle | null } {
  let hit: Obstacle | null = null;
  for (let iter = 0; iter < 3; iter++) {
    for (const o of obstacles) {
      if (o.id === ignoreId || !blocksAt(o, y)) continue;
      const c = contact(o, x, z);
      if (c.dist >= margin) continue;
      const push = margin - c.dist;
      x += c.nx * push;
      z += c.nz * push;
      hit = o;
    }
  }
  return { x, z, hit };
}

/** Odpychanie od bliskich przeszkód do sterowania zwierząt: tym silniejsze, im bliżej brzegu. */
export function steerAway(x: number, z: number, obstacles: Obstacle[], range: number, y?: number): [number, number] {
  let sx = 0;
  let sz = 0;
  for (const o of obstacles) {
    if (!blocksAt(o, y)) continue;
    const c = contact(o, x, z);
    if (c.dist >= range) continue;
    const k = (range - Math.max(c.dist, 0)) / range;
    sx += c.nx * k;
    sz += c.nz * k;
  }
  return [sx, sz];
}

export function insideAny(x: number, z: number, obstacles: Obstacle[], margin: number, y?: number): boolean {
  return obstacles.some((o) => blocksAt(o, y) && contact(o, x, z).dist < margin);
}
