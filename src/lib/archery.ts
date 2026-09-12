/**
 * Łucznictwo: naciąg łuku i lot strzały. Czysta arytmetyka na liczbach — scena czyta wejście,
 * woła krok i przepisuje wynik na modele (tak samo jak `ride.ts` prowadzi wierzchowce).
 */

/** Czas od napięcia cięciwy do pełnego naciągu [s]. */
export const DRAW_TIME = 0.75;
/** Poniżej tego naciągu puszczenie cięciwy nie wypuszcza strzały — chroni przed przypadkowym klikiem. */
export const DRAW_MIN = 0.15;
/**
 * Cofnięcie cięciwy przy pełnym naciągu [m] — tyle jedzie strzała na modelu łuku. Prawdziwy naciąg
 * to ~0,45 m, ale nasada musi zostać przed płaszczyzną bliską kamery (0,25 m), inaczej ręka i strzała
 * obcinają się w połowie.
 */
export const DRAW_PULL = 0.26;
/** Prędkość wylotowa od ledwie puszczonej cięciwy do pełnego naciągu [m/s]; ćwierć naciągu daje 28 m/s. */
export const SPEED_SLACK = 18;
export const SPEED_FULL = 58;
export const GRAVITY = 9.81;
/** Opór powietrza jako tłumienie liniowe [1/s] — na sekundę lotu strzała traci ~12% prędkości. */
export const DRAG = 0.12;
/** Po tylu sekundach pełnego naciągu ręka zaczyna drżeć. */
export const HOLD_STEADY = 2;
/** Drżenie dochodzi do pełnej amplitudy przez tyle sekund. */
export const SWAY_RISE = 3;
/** Największa amplituda drżenia [rad] — 0,4°. */
export const SWAY_MAX = 0.007;
/** Częstotliwości drżenia w poziomie i w pionie [Hz]. Różne, więc celownik krąży, a nie drga po linii. */
export const SWAY_HZ: [number, number] = [0.7, 1.1];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Naciąg 0…1 po `held` sekundach trzymania cięciwy. */
export function drawStrength(held: number): number {
  return clamp01(held / DRAW_TIME);
}

/** Prędkość wylotowa strzały przy danym naciągu [m/s]. */
export function arrowSpeed(draw: number): number {
  return SPEED_SLACK + (SPEED_FULL - SPEED_SLACK) * clamp01(draw);
}

/**
 * Drżenie ręki przy zbyt długim trzymaniu pełnego naciągu: obrót w poziomie i w pionie [rad].
 * `fullHeld` to czas w pełnym naciągu, `t` bieżący czas (faza drgania).
 */
export function sway(fullHeld: number, t: number): [number, number] {
  const amp = SWAY_MAX * clamp01((fullHeld - HOLD_STEADY) / SWAY_RISE);
  if (amp === 0) return [0, 0];
  return [amp * Math.sin(2 * Math.PI * SWAY_HZ[0] * t), amp * Math.sin(2 * Math.PI * SWAY_HZ[1] * t + 1.1)];
}

/** Strzała w locie: pozycja, prędkość i czas od wystrzału. */
export interface ArrowState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Czas lotu [s] — po nim strzała, która nic nie trafiła, gaśnie. */
  t: number;
}

export function newArrow(from: [number, number, number], dir: [number, number, number], speed: number): ArrowState {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return {
    x: from[0],
    y: from[1],
    z: from[2],
    vx: (dir[0] / len) * speed,
    vy: (dir[1] / len) * speed,
    vz: (dir[2] / len) * speed,
    t: 0,
  };
}

/** Odcinek przelecony w jednym kroku — scena szuka na nim trafienia. */
export interface ArrowStep {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** Długość odcinka [m]. */
  len: number;
}

/**
 * Jeden krok lotu. Zwraca odcinek, a nie samą nową pozycję: przy 58 m/s i 60 klatkach strzała robi
 * prawie metr na klatkę, więc trafienie trzeba szukać na całym odcinku, inaczej przelatuje przez ścianę.
 */
export function stepArrow(a: ArrowState, dt: number): ArrowStep {
  const x0 = a.x;
  const y0 = a.y;
  const z0 = a.z;
  const k = Math.exp(-DRAG * dt);
  a.vx *= k;
  a.vz *= k;
  a.vy = a.vy * k - GRAVITY * dt;
  a.x += a.vx * dt;
  a.y += a.vy * dt;
  a.z += a.vz * dt;
  a.t += dt;
  return { x0, y0, z0, x1: a.x, y1: a.y, z1: a.z, len: Math.hypot(a.x - x0, a.y - y0, a.z - z0) };
}
