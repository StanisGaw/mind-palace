/**
 * Przeszkody w poziomie dla zwierząt i wierzchowców: obrys obiektu jako prostokąt obrócony o `yaw`
 * (osie X/Z modelu), z podłogą i szczytem, żeby lot nad dachem nie liczył się jako zderzenie.
 * Czysta geometria — scena buduje listę z wpisów, a tu tylko liczymy odległości i wypychanie.
 */
/** Obrys bryły w jednym paśmie wysokości (świat). Pasma idą od dołu, `top` to ich górna granica. */
export interface ObstacleSlice {
  top: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export interface Obstacle {
  id: string;
  x: number;
  z: number;
  yaw: number;
  hx: number; // połowa szerokości wzdłuż lokalnego X
  hz: number; // połowa głębokości wzdłuż lokalnego Z
  bottom: number;
  top: number;
  /**
   * Obrys pasmami wysokości. Bez nich wieża zwężająca się ku górze blokowałaby przelot obrysem swojego
   * cokołu. Brak listy znaczy „jeden obrys na całą wysokość” — tak jest dla zwierząt i brył bez kształtu.
   */
  slices?: ObstacleSlice[];
}

export interface Contact {
  /** Odległość od brzegu w poziomie; ujemna wewnątrz (o tyle trzeba wypchnąć). */
  dist: number;
  /** Kierunek na zewnątrz (jednostkowy, w świecie). */
  nx: number;
  nz: number;
}

/** Obrys na wysokości `y`: pierwsze pasmo sięgające ponad `y`. Bez pasm albo bez `y` — obrys całej bryły. */
function sliceAt(o: Obstacle, y: number | undefined): { x: number; z: number; hx: number; hz: number } {
  if (!o.slices || o.slices.length === 0 || y === undefined) return o;
  for (const s of o.slices) if (y < s.top) return s;
  return o.slices[o.slices.length - 1];
}

/**
 * Odległość punktu od brzegu przeszkody i kierunek, w którym najbliżej na zewnątrz. `y` wybiera pasmo
 * wysokości: lecąc nad tarasem wieży liczy się obrys górnej kondygnacji, nie cokołu.
 */
export function contact(o: Obstacle, x: number, z: number, y?: number): Contact {
  const at = sliceAt(o, y);
  const dx = x - at.x;
  const dz = z - at.z;
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  // do układu obiektu: obrót o −yaw (obrót wokół Y w Three: x' = x·cos + z·sin, z' = −x·sin + z·cos)
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ex = Math.abs(lx) - at.hx;
  const ez = Math.abs(lz) - at.hz;
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
      const c = contact(o, x, z, y);
      if (c.dist >= margin) continue;
      const push = margin - c.dist;
      x += c.nx * push;
      z += c.nz * push;
      hit = o;
    }
  }
  return { x, z, hit };
}

/**
 * Kierunek do celu skorygowany tak, żeby obejść przeszkodę zamiast się w nią wbijać. Samo odpychanie
 * (dawne `steerAway`) znosi się z kierunkiem do celu, gdy idzie się prosto na ścianę — wypadkowa jest wtedy zerowa
 * i zwierzę staje pod murem. Tutaj im bliżej brzegu obrysu, tym bardziej kierunek przechodzi w **styczną**
 * do ściany, czyli w obejście; niewielka składowa na zewnątrz nie pozwala się o nią kleić.
 *
 * `dx`,`dz` to pożądany kierunek (nie musi być jednostkowy). `hx`,`hz` to dotychczasowy ruch: decyduje on,
 * którą stroną obejść, bo sam cel bywa schowany dokładnie za bryłą i ciągnąłby z powrotem na jej oś — wtedy
 * zwierzę drgałoby w miejscu zamiast obejść, a na narożniku zawracałoby. Domyślnie strony pilnuje sam cel.
 * Wynik jest jednostkowy, albo `[0, 0]`, gdy nie podano dokąd iść.
 */
export function avoid(x: number, z: number, dx: number, dz: number, obstacles: Obstacle[], range: number, y?: number, hx = dx, hz = dz): [number, number] {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return [0, 0];
  const ux = dx / len;
  const uz = dz / len;
  // najbliższa z brył, w które faktycznie idziemy — tylko ona decyduje o objeździe
  let best: Contact | null = null;
  let bestObs: Obstacle | null = null;
  for (const o of obstacles) {
    if (!blocksAt(o, y)) continue;
    const c = contact(o, x, z, y);
    if (c.dist >= range || (best && c.dist >= best.dist)) continue;
    if (c.nx * ux + c.nz * uz >= 0) continue; // ta bryła zostaje za plecami
    best = c;
    bestObs = o;
  }
  if (!best || !bestObs) return [ux, uz];
  let tx = -best.nz;
  let tz = best.nx;
  // strona obejścia: najpierw ciągłość ruchu (raz zaczęte obchodzenie trwa, także za narożnikiem),
  // a gdy zwierzę stoi — przesunięcie względem środka bryły, czyli bok, którym ma bliżej do jej końca
  const wzdluzRuchu = tx * hx + tz * hz;
  const lat = (x - bestObs.x) * tx + (z - bestObs.z) * tz;
  const wstecz = Math.abs(wzdluzRuchu) > 1e-6 ? wzdluzRuchu < 0 : lat < 0;
  if (wstecz) {
    tx = -tx;
    tz = -tz;
  }
  // pierwiastek zamiast wprost: skręt zaczyna się wyraźnie już na wejściu w zasięg, a przy samym murze
  // kierunek jest czysto styczny — wtedy zwierzę idzie wzdłuż ściany aż do jej końca
  const k = Math.sqrt(Math.min(1, Math.max(0, (range - Math.max(best.dist, 0)) / range)));
  const rx = ux * (1 - k) + tx * k;
  const rz = uz * (1 - k) + tz * k;
  const rl = Math.hypot(rx, rz);
  return rl < 1e-6 ? [tx, tz] : [rx / rl, rz / rl];
}

export function insideAny(x: number, z: number, obstacles: Obstacle[], margin: number, y?: number): boolean {
  return obstacles.some((o) => blocksAt(o, y) && contact(o, x, z, y).dist < margin);
}
