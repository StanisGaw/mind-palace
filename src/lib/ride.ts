/**
 * Przejażdżka: wspólna dynamika samolotu i wierzchowców (smok, koń, czerw). Czysta arytmetyka na liczbach —
 * scena czyta klawisze, woła krok i przepisuje wynik na model i kamerę. Przód wierzchowca to −Z (jak samolot).
 */

export type MountId = 'plane' | 'dragon' | 'horse' | 'sandworm' | 'horse2' | 'dragon2';

export interface MountLabels {
  /** Podpowiedź wsiadania: `${board}: ${nazwa obiektu}`. */
  board: string;
  leave: string;
  /** Pasek podpowiedzi na dole sceny (klawiatura i pad). */
  hintKeys: string;
  hintPad: string;
  /** Toast po wsiadnięciu. */
  toastKeys: string;
  toastPad: string;
  /** Podpis przycisku akcji na telefonie (skok, ogień); samolot ma zamiast niego przyciski gazu. */
  action?: string;
}

export interface MountSpec {
  /** `air` leci jak samolot, `hover` jak śmigłowiec (gaz unosi, zawisa w miejscu), `ground` jedzie po ziemi. */
  kind: 'air' | 'hover' | 'ground';
  maxSpeed: number; // m/s
  accel: number; // tempo dochodzenia prędkości do celu (lambda tłumienia)
  reach: number; // m od siodła (w poziomie), z których da się wsiąść
  climb?: number; // śmigłowiec: m/s wznoszenia i opadania przy pełnym gazie
  takeoff?: number; // poniżej tej prędkości maszyna toczy się po ziemi i nie reaguje na ster wysokości
  stall?: number; // poniżej: brak siły nośnej, maszyna opada
  ceiling?: number;
  turn?: number; // rad/s skrętu na ziemi
  walk?: number; // koń: prędkość bez galopu
  jump?: number; // koń: impuls pionowy m/s
  /** Czerw: wyskok z piasku łukiem. */
  leap?: { height: number; duration: number };
  labels: MountLabels;
}

export const MOUNT_SPECS = {
  plane: {
    kind: 'air',
    maxSpeed: 24,
    accel: 0.5,
    reach: 3,
    takeoff: 11,
    stall: 10,
    ceiling: 90,
    labels: {
      board: 'Wsiądź do',
      leave: 'Wysiądź z samolotu',
      hintKeys: 'Shift/Ctrl — gaz · W/S — nos · A/D — przechył · Q/E — kierunek · mysz — rozglądanie · F — wysiądź lub skok',
      hintPad: 'R2/L2 — gaz · lewa gałka — nos i przechył · L1/R1 — kierunek · prawa gałka — rozglądanie · ▢ — wysiądź lub skok',
      toastKeys: 'Shift — gaz, Ctrl — wolniej, W/S — nos, A/D — przechył, Q/E — kierunek. F na ziemi wysiada, w powietrzu — skok ze spadochronem.',
      toastPad: 'R2 — gaz, L2 — wolniej, lewa gałka — nos i przechył, L1/R1 — kierunek. ▢ na ziemi wysiada, w powietrzu — skok ze spadochronem.',
    },
  },
  dragon: {
    kind: 'hover',
    maxSpeed: 18,
    accel: 1.2,
    reach: 3.5,
    climb: 6,
    ceiling: 90,
    labels: {
      board: 'Dosiądź',
      leave: 'Zsiądź ze smoka',
      hintKeys: 'Shift/Ctrl — w górę i w dół · W/S — do przodu i do tyłu · A/D — skręt · Q/E — obrót w miejscu · Spacja lub klik — ogień · F — zsiądź lub skok',
      hintPad: 'R2/L2 — w górę i w dół · lewa gałka — lot i skręt · L1/R1 — obrót w miejscu · △ — ogień · ▢ — zsiądź lub skok',
      toastKeys: 'Shift unosi, Ctrl opuszcza; puszczone — smok zawisa. W/S — do przodu i do tyłu, A/D — skręt, Q/E — obrót w miejscu, Spacja albo klik — ogień. F na ziemi zsiada, w powietrzu — skok ze spadochronem.',
      toastPad: 'R2 unosi, L2 opuszcza; puszczone — smok zawisa. Lewa gałka — lot i skręt, L1/R1 — obrót w miejscu, △ — ogień. ▢ na ziemi zsiada, w powietrzu — skok ze spadochronem.',
      action: 'Ogień',
    },
  },
  horse: {
    kind: 'ground',
    maxSpeed: 12,
    accel: 2.5,
    reach: 2.5,
    turn: 1.8,
    walk: 3.5,
    jump: 5.5,
    labels: {
      board: 'Dosiądź',
      leave: 'Zsiądź z konia',
      hintKeys: 'W/S — stęp i cofanie · Shift — galop · A/D — skręt · Spacja — skok · mysz — rozglądanie · F — zsiądź',
      hintPad: 'Lewa gałka — jazda i skręt · spusty — galop · ✕ — skok · prawa gałka — rozglądanie · ▢ — zsiądź',
      toastKeys: 'W — stęp, Shift — galop, S — cofanie, A/D — skręt, Spacja — skok. F po zatrzymaniu zsiada.',
      toastPad: 'Lewa gałka — jazda i skręt, spusty — galop, ✕ — skok. ▢ po zatrzymaniu zsiada.',
      action: 'Skok',
    },
  },
  sandworm: {
    kind: 'ground',
    maxSpeed: 16,
    accel: 0.25,
    reach: 6,
    turn: 0.45,
    leap: { height: 6, duration: 2.4 },
    labels: {
      board: 'Dosiądź',
      leave: 'Zsiądź z czerwia',
      hintKeys: 'Shift/Ctrl — rozpęd · A/D — skręt · Spacja — wyskok z piasku · mysz — rozglądanie · F — zsiądź',
      hintPad: 'R2/L2 — rozpęd · lewa gałka — skręt · ✕ — wyskok z piasku · prawa gałka — rozglądanie · ▢ — zsiądź',
      toastKeys: 'Shift — rozpęd (czerw rusza powoli), Ctrl — hamowanie, A/D — skręt szerokim łukiem, Spacja — wyskok z piasku. F po zatrzymaniu zsiada.',
      toastPad: 'R2 — rozpęd (czerw rusza powoli), L2 — hamowanie, lewa gałka — skręt, ✕ — wyskok z piasku. ▢ po zatrzymaniu zsiada.',
      action: 'Wyskok',
    },
  },
} as Record<MountId, MountSpec>;

// wierzchowce z plików GLB dzielą dynamikę i teksty z proceduralnymi odpowiednikami
MOUNT_SPECS.horse2 = { ...MOUNT_SPECS.horse, reach: 2.8 };
MOUNT_SPECS.dragon2 = { ...MOUNT_SPECS.dragon, reach: 3.5 };

export function isMount(type: string): type is MountId {
  return Object.prototype.hasOwnProperty.call(MOUNT_SPECS, type);
}

export interface RideState {
  x: number;
  y: number; // punkt zaczepienia modelu (stopy, koła)
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number; // 0..1 (samolot, czerw); śmigłowiec: 0,5 to zawis, wyżej wznoszenie, niżej opadanie (przyciski telefonu)
  onGround: boolean;
  /** Gracz siedzi w siodle. Po skoku maszyna leci sama: lekki gaz, wyrównany lot, aż stanie na ziemi. */
  pilot: boolean;
  vy: number; // koń: prędkość pionowa skoku
  phase: number; // faza animacji (chód, machanie skrzydłami), rośnie z przebytą drogą
  leapT: number; // czerw: czas od początku wyskoku, −1 gdy nie skacze
  fire: number; // smok: ile sekund jeszcze zionie
}

export interface RideInput {
  throttle: number; // −1..1: gaz i hamowanie (samolot, czerw), w górę i w dół (śmigłowiec) albo naprzód i wstecz (koń)
  pitch: number; // −1..1: nos w górę (+, klawisz S) i w dół (−, klawisz W) — jak drążek; śmigłowiec: do przodu (+) i do tyłu (−)
  roll: number; // −1..1: przechył w prawo (+)
  yaw: number; // −1..1: ster kierunku w prawo (+)
  turn: number; // −1..1: skręt na ziemi w prawo (+)
  sprint: boolean;
  jump: boolean;
  fire: boolean;
}

export interface RideEnv {
  groundAt: (x: number, z: number) => number;
  /** Promień świata: dalej nie da się odjechać ani odlecieć. */
  radius: number;
  /** Maszyna bez pilota nie opuszcza planszy: gdzie stanie, tam trzeba do niej dojść. */
  clampToBoard?: (x: number, z: number) => [number, number];
  /** Skala wierzchowca: powiększony czerw wyskakuje odpowiednio wyżej. */
  scale?: number;
}

export const IDLE_INPUT: RideInput = { throttle: 0, pitch: 0, roll: 0, yaw: 0, turn: 0, sprint: false, jump: false, fire: false };

const FIRE_TIME = 1.2; // s jednego zionięcia
const GRAVITY = 20; // m/s² jak w `physics.stepCharacter`
const LEAP_MIN_SPEED = 4; // czerw wyskakuje dopiero rozpędzony

export function newRideState(x: number, y: number, z: number, yaw: number, spec?: MountSpec): RideState {
  return { x, y, z, yaw, pitch: 0, roll: 0, speed: 0, throttle: spec?.kind === 'hover' ? 0.5 : 0, onGround: true, pilot: true, vy: 0, phase: 0, leapT: -1, fire: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Tłumienie wykładnicze niezależne od długości klatki (jak `THREE.MathUtils.damp`). */
const damp = (x: number, y: number, lambda: number, dt: number) => x + (y - x) * (1 - Math.exp(-lambda * dt));

/** Wspólne zakończenie kroku: zacisk promienia świata, zawinięcie kąta, faza animacji, ogień. */
function finishStep(r: RideState, input: RideInput, env: RideEnv, dt: number) {
  const d = Math.hypot(r.x, r.z);
  if (d > env.radius) {
    r.x *= env.radius / d;
    r.z *= env.radius / d;
  }
  // kąty zawijamy do pełnego obrotu: po długiej jeździe trafiają do zapisu pałacu i do macierzy
  r.yaw = Math.atan2(Math.sin(r.yaw), Math.cos(r.yaw));
  r.phase += Math.abs(r.speed) * dt;
  if (input.fire && r.pilot && r.fire <= 0) r.fire = FIRE_TIME;
  r.fire = Math.max(0, r.fire - dt);
}

/**
 * Lot: samolot i smok. Gaz nadaje prędkość, prędkość daje siłę nośną i autorytet sterów; przechył zakręca.
 * Smok (`hover`) unosi się z samego gazu, więc startuje pionowo i zawisa przy małej prędkości.
 */
export function stepAir(r: RideState, input: RideInput, spec: MountSpec, env: RideEnv, dt: number) {
  const takeoff = spec.takeoff ?? 11;
  const stall = spec.stall ?? 10;
  const ceiling = spec.ceiling ?? 90;
  if (r.pilot) r.throttle = clamp(r.throttle + input.throttle * dt * 0.5, 0, 1);
  // bez pilota: w powietrzu lekki gaz (0,3 — poniżej prędkości przeciągnięcia) daje długie, płaskie
  // szybowanie zamiast pionowego spadku po utracie siły nośnej; na ziemi gaz do zera, maszyna staje
  else r.throttle = damp(r.throttle, r.onGround ? 0 : 0.3, 1.5, dt);
  r.speed = damp(r.speed, r.throttle * spec.maxSpeed, spec.accel, dt);

  const pitchIn = r.pilot ? input.pitch : 0;
  const rollIn = r.pilot ? input.roll : 0;
  const yawIn = r.pilot ? input.yaw : 0;
  // stery działają tym mocniej, im większy opływ — przy postoju maszyna nie reaguje
  const auth = clamp(r.speed / takeoff, 0, 1);

  if (r.onGround && r.speed < takeoff) {
    r.pitch = damp(r.pitch, 0, 6, dt);
    r.roll = damp(r.roll, 0, 6, dt);
    r.yaw -= (yawIn * 0.9 + rollIn * 0.7) * Math.min(r.speed / 5, 1) * dt; // kołowanie kółkiem ogonowym
  } else {
    r.pitch = clamp(r.pitch + pitchIn * 1.0 * auth * dt, -0.8, 0.8);
    r.roll = clamp(r.roll - rollIn * 1.7 * auth * dt, -1.1, 1.1);
    // puszczone stery same wracają do lotu poziomego — inaczej łatwo wpaść w spiralę
    if (pitchIn === 0) r.pitch = damp(r.pitch, 0, 0.6, dt);
    if (!r.pilot) r.roll = damp(r.roll, -0.5, 1.5, dt); // porzucona maszyna krąży, zamiast odlecieć za horyzont
    else if (rollIn === 0) r.roll = damp(r.roll, 0, 0.9, dt);
    r.yaw += (Math.sin(r.roll) * 0.9 * auth - yawIn * 0.8) * dt; // przechył zakręca
    if (r.onGround) {
      r.roll = damp(r.roll, 0, 5, dt);
      r.pitch = Math.max(r.pitch, 0);
    }
  }

  const lift = clamp(r.speed / stall, 0, 1);
  const horiz = Math.cos(r.pitch) * r.speed;
  r.x -= Math.sin(r.yaw) * horiz * dt;
  r.z -= Math.cos(r.yaw) * horiz * dt;
  r.y += (Math.sin(r.pitch) * r.speed - (1 - lift) * 7) * dt;

  r.y = Math.min(r.y, ceiling);
  if (!r.pilot && env.clampToBoard) {
    const [bx, bz] = env.clampToBoard(r.x, r.z);
    r.x = bx;
    r.z = bz;
  }
  finishStep(r, input, env, dt);
  const gy = env.groundAt(r.x, r.z);
  if (r.y <= gy) {
    r.y = gy;
    if (!r.onGround) {
      // przyziemienie hamuje maszynę i ścina gaz do tego, co zostało z prędkości
      r.speed *= 0.72;
      r.throttle = Math.min(r.throttle, r.speed / spec.maxSpeed);
    }
    r.onGround = true;
  } else r.onGround = false;
}

/**
 * Śmigłowiec: smok. Gaz unosi i opuszcza, a puszczony zostawia maszynę w zawisie; W/S przesuwa do przodu
 * i do tyłu, A/D skręca w locie (z przechyłem), Q/E obraca w miejscu. Bez pilota smok opada i siada.
 */
export function stepHover(r: RideState, input: RideInput, spec: MountSpec, env: RideEnv, dt: number) {
  const climb = spec.climb ?? 5;
  const ceiling = spec.ceiling ?? 90;
  // przyciski telefonu przestawiają `throttle` na stałe; klawisz i spust działają, póki są trzymane
  const vertIn = r.pilot ? clamp(input.throttle + (r.throttle - 0.5) * 2, -1, 1) : -0.3;
  const fwdIn = r.pilot ? input.pitch : 0;
  const turnIn = r.pilot ? input.roll : 0;
  const yawIn = r.pilot ? input.yaw : 0;

  const target = fwdIn > 0 ? spec.maxSpeed * fwdIn : fwdIn < 0 ? spec.maxSpeed * 0.4 * fwdIn : 0;
  r.speed = damp(r.speed, target, spec.accel, dt);
  // na ziemi smok tylko się obraca; w locie skręca z przechyłem
  const airborne = !r.onGround;
  r.yaw -= (yawIn * 1.4 + (airborne ? turnIn * 1.1 : 0)) * dt;
  r.pitch = damp(r.pitch, airborne ? -0.28 * (r.speed / spec.maxSpeed) : 0, 3, dt); // nos w dół, gdy leci do przodu
  r.roll = damp(r.roll, airborne ? -turnIn * 0.45 : 0, 3, dt);

  r.vy = damp(r.vy, vertIn * climb, 4, dt);
  r.x -= Math.sin(r.yaw) * r.speed * dt;
  r.z -= Math.cos(r.yaw) * r.speed * dt;
  r.y += r.vy * dt;
  r.y = Math.min(r.y, ceiling);
  if (!r.pilot && env.clampToBoard) {
    const [bx, bz] = env.clampToBoard(r.x, r.z);
    r.x = bx;
    r.z = bz;
  }
  finishStep(r, input, env, dt);
  const gy = env.groundAt(r.x, r.z);
  if (r.y <= gy && r.vy <= 0) {
    r.y = gy;
    r.vy = 0;
    r.onGround = true;
    if (!r.pilot) r.speed = damp(r.speed, 0, 3, dt);
  } else r.onGround = r.y <= gy;
}

/**
 * Jazda po ziemi: koń i czerw. Koń rusza od razu i skręca w miejscu, skacze; czerw rozpędza się gazem,
 * skręca szerokim łukiem i wyskakuje z piasku łukiem, po czym wraca na powierzchnię.
 */
export function stepGround(r: RideState, input: RideInput, spec: MountSpec, env: RideEnv, dt: number) {
  const turn = spec.turn ?? 1.5;
  let target: number;
  if (spec.leap) {
    if (r.pilot) r.throttle = clamp(r.throttle + input.throttle * dt * 0.5, 0, 1);
    else r.throttle = damp(r.throttle, 0, 1.5, dt);
    target = r.throttle * spec.maxSpeed;
  } else {
    const walk = spec.walk ?? spec.maxSpeed * 0.3;
    const fwd = r.pilot ? input.throttle : 0;
    target = fwd > 0 ? (input.sprint ? spec.maxSpeed : walk) * fwd : fwd < 0 ? walk * 0.4 * fwd : 0;
  }
  r.speed = damp(r.speed, target, spec.accel, dt);

  const turnIn = r.pilot ? input.turn : 0;
  // czerw skręca tym ciaśniej, im szybciej płynie; koń obraca się także w miejscu, tylko wolniej
  const turnScale = spec.leap ? Math.min(Math.abs(r.speed) / 6, 1) : Math.abs(r.speed) < 0.5 ? 0.6 : 1;
  r.yaw -= turnIn * turn * turnScale * dt;

  r.x -= Math.sin(r.yaw) * r.speed * dt;
  r.z -= Math.cos(r.yaw) * r.speed * dt;
  r.roll = 0;
  finishStep(r, input, env, dt);

  const gy = env.groundAt(r.x, r.z);
  if (spec.leap) {
    if (r.leapT < 0 && input.jump && r.pilot && r.onGround && r.speed > LEAP_MIN_SPEED) r.leapT = 0;
    if (r.leapT >= 0) {
      r.leapT += dt;
      const t = r.leapT / spec.leap.duration;
      if (t >= 1) {
        r.leapT = -1;
        r.y = gy;
        r.onGround = true;
      } else {
        // nos w górę przy wyjściu z piasku, w dół przy wejściu
        r.y = gy + spec.leap.height * (env.scale ?? 1) * Math.sin(Math.PI * t);
        r.pitch = 0.7 * Math.cos(Math.PI * t);
        r.onGround = false;
      }
    } else {
      r.y = gy;
      r.pitch = damp(r.pitch, 0, 4, dt);
      r.onGround = true;
    }
    return;
  }
  r.pitch = 0;
  if (spec.jump && r.onGround && input.jump && r.pilot) {
    r.vy = spec.jump;
    r.onGround = false;
  }
  if (!r.onGround) {
    r.vy -= GRAVITY * dt;
    r.y += r.vy * dt;
    if (r.y <= gy) {
      r.y = gy;
      r.vy = 0;
      r.onGround = true;
    }
  } else {
    r.y = gy;
    r.vy = 0;
  }
}

export function stepRide(r: RideState, input: RideInput, spec: MountSpec, env: RideEnv, dt: number) {
  if (spec.kind === 'air') stepAir(r, input, spec, env, dt);
  else if (spec.kind === 'hover') stepHover(r, input, spec, env, dt);
  else stepGround(r, input, spec, env, dt);
}

/** Czy maszyna bez pilota już stanęła i może wrócić do pałacu jako zwykły obiekt. */
export function rideSettled(r: RideState): boolean {
  return !r.pilot && r.onGround && Math.abs(r.speed) < 0.3;
}

/**
 * Ślad głowy czerwia: płaska tablica xyz, najnowsza próbka na końcu. Nową próbkę dopisuje dopiero po
 * przebyciu `step`, a najstarsze obcina, żeby ślad nie rósł bez końca. Zwraca, czy coś dopisał.
 */
export function advanceTrail(trail: number[], x: number, y: number, z: number, step: number, max: number): boolean {
  const n = trail.length;
  if (n >= 3) {
    const dx = x - trail[n - 3];
    const dy = y - trail[n - 2];
    const dz = z - trail[n - 1];
    if (dx * dx + dy * dy + dz * dz < step * step) return false;
  }
  trail.push(x, y, z);
  if (trail.length > max * 3) trail.splice(0, trail.length - max * 3);
  return true;
}

/**
 * Punkt na śladzie w odległości `dist` za głową, licząc wzdłuż łamanej: od głowy do najnowszej próbki,
 * dalej po kolejnych. Segmenty ciała ciągną się tędy płynnie, bez skoku przy dopisaniu nowej próbki.
 * Gdy ślad jest za krótki, punkt leży na przedłużeniu ostatniego odcinka.
 */
export function trailPoint(trail: number[], hx: number, hy: number, hz: number, dist: number): [number, number, number] {
  let px = hx;
  let py = hy;
  let pz = hz;
  let left = dist;
  let lastDx = 0;
  let lastDy = 0;
  let lastDz = 1;
  for (let i = trail.length - 3; i >= 0; i -= 3) {
    const dx = trail[i] - px;
    const dy = trail[i + 1] - py;
    const dz = trail[i + 2] - pz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) continue;
    if (len >= left) {
      const k = left / len;
      return [px + dx * k, py + dy * k, pz + dz * k];
    }
    left -= len;
    px = trail[i];
    py = trail[i + 1];
    pz = trail[i + 2];
    lastDx = dx / len;
    lastDy = dy / len;
    lastDz = dz / len;
  }
  return [px + lastDx * left, py + lastDy * left, pz + lastDz * left];
}
