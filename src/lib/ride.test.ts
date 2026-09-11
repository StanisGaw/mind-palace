/**
 * Przejażdżka wierzchowcem: dynamika lotu i jazdy jest czystą arytmetyką, więc sprawdzamy ją tutaj, zanim
 * scena przepisze wynik na model i kamerę. Wartości samolotu odpowiadają dawnej całce z `SceneManager`:
 * poniżej prędkości startowej maszyna nie odrywa się od ziemi, poniżej prędkości przeciągnięcia opada.
 * Osobno pilnujemy katalogu: kategoria bez wpisu w `CATEGORY_ORDER` znikałaby z biblioteki po cichu.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG, CATEGORY_LABELS, CATEGORY_ORDER } from '../catalog';
import { normalizePalace } from './storage';
import { IDLE_INPUT, MOUNT_SPECS, advanceTrail, isMount, newRideState, resolveBump, rideSettled, stepAir, stepGround, stepHover, trailPoint, type MountId, type RideEnv, type RideInput, type RideState } from './ride';

const flat: RideEnv = { groundAt: () => 0, radius: 200 };
const input = (over: Partial<RideInput>): RideInput => ({ ...IDLE_INPUT, ...over });

function run(r: RideState, inp: RideInput, mount: MountId, env: RideEnv, seconds: number, dt = 1 / 60) {
  const spec = MOUNT_SPECS[mount];
  for (let t = 0; t < seconds; t += dt) {
    if (spec.kind === 'air') stepAir(r, inp, spec, env, dt);
    else if (spec.kind === 'hover') stepHover(r, inp, spec, env, dt);
    else stepGround(r, inp, spec, env, dt);
  }
  return r;
}

describe('katalog pojazdów', () => {
  it('każdy wierzchowiec ma wpis w kategorii Pojazdy i odwrotnie', () => {
    for (const id of Object.keys(MOUNT_SPECS)) {
      const item = CATALOG.find((c) => c.id === id);
      expect(item, `brak wpisu ${id}`).toBeDefined();
      expect(item!.category, `${id} poza kategorią vehicle`).toBe('vehicle');
    }
    for (const item of CATALOG.filter((c) => c.category === 'vehicle')) expect(isMount(item.id), `${item.id} bez dynamiki jazdy`).toBe(true);
  });

  it('stare zapisy z Koniem 2 i Smokiem 2 wracają do konia i smoka', () => {
    const obj = (id: string, type: string) => ({ id, type, name: type, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] });
    const p = normalizePalace({ id: 'x', name: 'Stary', objects: [obj('a', 'horse2'), obj('b', 'dragon2'), obj('c', 'horse')] });
    expect(p.objects.map((o) => o.type)).toEqual(['horse', 'dragon', 'horse']);
  });

  it('każda kategoria z etykietą jest w kolejności biblioteki', () => {
    for (const cat of Object.keys(CATEGORY_LABELS)) expect(CATEGORY_ORDER, `kategoria ${cat} niewidoczna`).toContain(cat);
  });
});

describe('samolot', () => {
  it('poniżej prędkości startowej ster wysokości nie działa i maszyna zostaje na ziemi', () => {
    const r = newRideState(0, 0, 0, 0);
    r.speed = 8;
    r.throttle = 8 / 24;
    run(r, input({ pitch: 1 }), 'plane', flat, 1.5);
    expect(r.y).toBe(0);
    expect(r.onGround).toBe(true);
    expect(Math.abs(r.pitch)).toBeLessThan(0.01);
  });

  it('po rozpędzeniu nos w górę odrywa maszynę od ziemi, a prędkość rośnie z gazem', () => {
    const r = newRideState(0, 0, 0, 0);
    run(r, input({ throttle: 1 }), 'plane', flat, 6);
    expect(r.speed).toBeGreaterThan(18);
    run(r, input({ throttle: 1, pitch: 1 }), 'plane', flat, 2);
    expect(r.y).toBeGreaterThan(5);
    expect(r.onGround).toBe(false);
    expect(r.z).toBeLessThan(-50); // przód to −Z
  });

  it('poniżej prędkości przeciągnięcia maszyna opada i przyziemienie hamuje', () => {
    const r = newRideState(0, 30, 0, 0);
    r.onGround = false;
    r.speed = 6;
    const before = r.y;
    run(r, IDLE_INPUT, 'plane', flat, 1);
    expect(r.y).toBeLessThan(before - 3);
    run(r, IDLE_INPUT, 'plane', flat, 10);
    expect(r.y).toBe(0);
    expect(r.onGround).toBe(true);
    expect(r.speed).toBeLessThan(6);
  });

  it('nie przekracza pułapu ani promienia świata', () => {
    const r = newRideState(0, 85, 0, 0);
    r.onGround = false;
    r.speed = 24;
    r.throttle = 1;
    run(r, input({ throttle: 1, pitch: 1 }), 'plane', { groundAt: () => 0, radius: 40 }, 6);
    expect(r.y).toBeLessThanOrEqual(90);
    expect(Math.hypot(r.x, r.z)).toBeLessThanOrEqual(40.001);
  });

  it('bez pilota szybuje w dół, kręci się w kółko i staje na planszy', () => {
    const r = newRideState(0, 20, 0, 0);
    r.onGround = false;
    r.pilot = false;
    r.speed = 20;
    r.throttle = 0.8;
    const env: RideEnv = { ...flat, clampToBoard: (x, z) => [Math.max(-10, Math.min(10, x)), Math.max(-10, Math.min(10, z))] };
    run(r, IDLE_INPUT, 'plane', env, 40);
    expect(rideSettled(r)).toBe(true);
    expect(Math.abs(r.x)).toBeLessThanOrEqual(10);
    expect(Math.abs(r.z)).toBeLessThanOrEqual(10);
  });
});

describe('smok wierzchowy (śmigłowiec)', () => {
  const dragon = () => newRideState(0, 0, 0, 0, MOUNT_SPECS.dragon);

  it('unosi się pionowo na gazie i bez ruchu w poziomie', () => {
    const r = dragon();
    run(r, input({ throttle: 1 }), 'dragon', flat, 2);
    expect(r.y).toBeGreaterThan(5);
    expect(r.onGround).toBe(false);
    expect(Math.hypot(r.x, r.z)).toBeLessThan(0.01);
  });

  it('po puszczeniu gazu zawisa w miejscu, a Ctrl opuszcza aż do lądowania', () => {
    const r = dragon();
    r.y = 20;
    r.onGround = false;
    run(r, IDLE_INPUT, 'dragon', flat, 3);
    expect(r.y).toBeCloseTo(20, 1);
    run(r, input({ throttle: -1 }), 'dragon', flat, 6);
    expect(r.y).toBe(0);
    expect(r.onGround).toBe(true);
  });

  it('W leci do przodu z nosem w dół, S cofa wolniej, A/D skręca tylko w locie', () => {
    const fwd = dragon();
    fwd.y = 10;
    fwd.onGround = false;
    run(fwd, input({ pitch: 1 }), 'dragon', flat, 3);
    expect(fwd.z).toBeLessThan(-20);
    expect(fwd.pitch).toBeLessThan(-0.1);
    expect(fwd.y).toBeCloseTo(10, 1);
    const back = dragon();
    back.y = 10;
    back.onGround = false;
    run(back, input({ pitch: -1 }), 'dragon', flat, 3);
    expect(back.z).toBeGreaterThan(0);
    expect(back.z).toBeLessThan(-fwd.z * 0.6);
    const ground = dragon();
    run(ground, input({ roll: 1 }), 'dragon', flat, 1);
    expect(ground.yaw).toBe(0);
    const air = dragon();
    air.y = 10;
    air.onGround = false;
    run(air, input({ roll: 1 }), 'dragon', flat, 1);
    expect(air.yaw).toBeLessThan(-0.5);
  });

  it('przyciski gazu na telefonie ustawiają wznoszenie na stałe', () => {
    const r = dragon();
    r.throttle = 0.75;
    run(r, IDLE_INPUT, 'dragon', flat, 2);
    expect(r.y).toBeGreaterThan(2);
  });

  it('po zeskoku opada i siada', () => {
    const r = dragon();
    r.y = 25;
    r.onGround = false;
    r.pilot = false;
    r.speed = 12;
    run(r, IDLE_INPUT, 'dragon', flat, 40);
    expect(rideSettled(r)).toBe(true);
  });

  it('ogień gaśnie po chwili', () => {
    const r = newRideState(0, 0, 0, 0);
    run(r, input({ fire: true }), 'dragon', flat, 0.2);
    expect(r.fire).toBeGreaterThan(0.8);
    run(r, IDLE_INPUT, 'dragon', flat, 1.5);
    expect(r.fire).toBe(0);
  });
});

describe('koń', () => {
  const slope: RideEnv = { groundAt: (x) => x * 0.2, radius: 200 };

  it('trzyma się gruntu na pochyłości i galopuje do pełnej prędkości', () => {
    const r = newRideState(0, 0, 0, -Math.PI / 2); // przód −Z obrócony na +X
    run(r, input({ throttle: 1, sprint: true }), 'horse', slope, 4);
    expect(r.x).toBeGreaterThan(20);
    expect(r.y).toBeCloseTo(r.x * 0.2, 5);
    expect(r.speed).toBeGreaterThan(11);
    expect(r.onGround).toBe(true);
  });

  it('skok odrywa od ziemi i kończy się w niecałe półtorej sekundy', () => {
    const r = newRideState(0, 0, 0, 0);
    stepGround(r, input({ jump: true }), MOUNT_SPECS.horse, flat, 1 / 60);
    expect(r.onGround).toBe(false);
    let airborne = 0;
    for (let t = 0; t < 1.5 && !r.onGround; t += 1 / 60) {
      stepGround(r, IDLE_INPUT, MOUNT_SPECS.horse, flat, 1 / 60);
      airborne += 1 / 60;
    }
    expect(r.onGround).toBe(true);
    expect(airborne).toBeLessThan(1.5);
    expect(airborne).toBeGreaterThan(0.3);
  });

  it('skręca w miejscu, a cofa wolniej niż idzie', () => {
    const r = newRideState(0, 0, 0, 0);
    run(r, input({ turn: 1 }), 'horse', flat, 1);
    expect(r.yaw).toBeLessThan(-0.5);
    const fwd = run(newRideState(0, 0, 0, 0), input({ throttle: 1 }), 'horse', flat, 3);
    const back = run(newRideState(0, 0, 0, 0), input({ throttle: -1 }), 'horse', flat, 3);
    expect(Math.abs(back.z)).toBeLessThan(Math.abs(fwd.z) * 0.6);
    expect(back.z).toBeGreaterThan(0);
  });
});

describe('czerw pustynny', () => {
  it('rozpędza się powoli i długo hamuje', () => {
    const r = newRideState(0, 0, 0, 0);
    run(r, input({ throttle: 1 }), 'sandworm', flat, 2);
    expect(r.speed).toBeLessThan(8);
    run(r, input({ throttle: 1 }), 'sandworm', flat, 12);
    const top = r.speed;
    expect(top).toBeGreaterThan(12);
    run(r, input({ throttle: -1 }), 'sandworm', flat, 3);
    expect(r.speed).toBeGreaterThan(top * 0.5);
  });

  it('wyskakuje z piasku dopiero rozpędzony i wraca na ziemię po czasie skoku', () => {
    const slowWorm = newRideState(0, 0, 0, 0);
    slowWorm.speed = 2;
    stepGround(slowWorm, input({ jump: true }), MOUNT_SPECS.sandworm, flat, 1 / 60);
    expect(slowWorm.leapT).toBe(-1);

    const r = newRideState(0, 0, 0, 0);
    r.speed = 10;
    r.throttle = 10 / 16;
    stepGround(r, input({ jump: true, throttle: 1 }), MOUNT_SPECS.sandworm, flat, 1 / 60);
    expect(r.leapT).toBeGreaterThanOrEqual(0);
    run(r, input({ throttle: 1 }), 'sandworm', flat, 1.2);
    expect(r.y).toBeGreaterThan(4);
    expect(r.onGround).toBe(false);
    run(r, input({ throttle: 1 }), 'sandworm', flat, 1.4);
    expect(r.y).toBe(0);
    expect(r.onGround).toBe(true);
    expect(r.leapT).toBe(-1);
  });

  it('skręca szerokim łukiem', () => {
    const r = newRideState(0, 0, 0, 0);
    r.speed = 16;
    r.throttle = 1;
    run(r, input({ throttle: 1, turn: 1 }), 'sandworm', flat, 1);
    expect(-r.yaw).toBeCloseTo(0.45, 1);
  });

  it('ślad dopisuje próbki co krok i obcina najstarsze', () => {
    const trail: number[] = [];
    expect(advanceTrail(trail, 0, 0, 0, 1.5, 4)).toBe(true);
    expect(advanceTrail(trail, 0.5, 0, 0, 1.5, 4)).toBe(false);
    for (let i = 1; i <= 6; i++) advanceTrail(trail, 0, 0, -i * 2, 1.5, 4);
    expect(trail.length).toBe(12);
    expect(trail[trail.length - 1]).toBe(-12);
  });

  it('punkt na śladzie leży w zadanej odległości za głową, także poza końcem śladu', () => {
    const trail: number[] = [];
    for (let i = 0; i <= 5; i++) advanceTrail(trail, 0, 0, 10 - i * 2, 1.5, 20); // czerw jedzie w −Z
    const head: [number, number, number] = [0, 0, -1];
    const near = trailPoint(trail, head[0], head[1], head[2], 3);
    expect(near[2]).toBeCloseTo(2, 5);
    const far = trailPoint(trail, head[0], head[1], head[2], 20);
    expect(far[2]).toBeCloseTo(19, 5); // przedłużenie ostatniego odcinka
  });
});

describe('resolveBump — ślizg wzdłuż ściany', () => {
  // ściana biegnie wzdłuż osi X, normalna wskazuje na +Z (maszyna nadlatuje od strony +Z, czyli leci w −Z)
  const WALL: [number, number] = [0, 1];
  const spec = MOUNT_SPECS.plane;
  /** Maszyna lecąca z prędkością `speed` pod kursem `yaw`; przód to −Z, więc yaw 0 leci prosto w ścianę. */
  const flying = (yaw: number, speed = 20): RideState => ({ ...newRideState(0, 30, 0, yaw, spec), speed, onGround: false });

  it('lot prosto w mur nie zatrzymuje maszyny', () => {
    const r = flying(0);
    for (let t = 0; t < 0.5; t += 1 / 60) resolveBump(r, WALL[0], WALL[1], spec, 1 / 60);
    expect(r.speed).toBeGreaterThan(4); // z 20 m/s zostaje wyraźny pęd, nie zero
  });

  it('lot prosto w mur układa kurs wzdłuż ściany', () => {
    const r = flying(0);
    for (let t = 0; t < 0.6; t += 1 / 60) resolveBump(r, WALL[0], WALL[1], spec, 1 / 60);
    // kurs wzdłuż ściany to ±90°: składowa ruchu w stronę ściany (−cos yaw) ma zniknąć
    expect(Math.abs(Math.cos(r.yaw))).toBeLessThan(0.15);
  });

  it('muśnięcie pod ostrym kątem kosztuje niewiele prędkości', () => {
    const grazing = flying(Math.PI / 2 - 0.25); // prawie równolegle do ściany
    const head = flying(0);
    for (let t = 0; t < 0.2; t += 1 / 60) {
      resolveBump(grazing, WALL[0], WALL[1], spec, 1 / 60);
      resolveBump(head, WALL[0], WALL[1], spec, 1 / 60);
    }
    expect(grazing.speed).toBeGreaterThan(19);
    expect(grazing.speed).toBeGreaterThan(head.speed * 1.15);
  });

  it('ruch od ściany nie jest karany', () => {
    const r = flying(Math.PI); // przód w +Z, czyli w stronę normalnej
    const before = r.speed;
    const into = resolveBump(r, WALL[0], WALL[1], spec, 1 / 60);
    expect(into).toBe(0);
    expect(r.speed).toBe(before);
    expect(r.yaw).toBe(Math.PI);
  });

  it('stojąca maszyna nie jest obracana', () => {
    const r = { ...flying(0), speed: 0.05 };
    expect(resolveBump(r, WALL[0], WALL[1], spec, 1 / 60)).toBe(0);
    expect(r.yaw).toBe(0);
  });

  it('strona ślizgu nie migocze między klatkami', () => {
    const r = flying(0.01); // nos ledwie odchylony — tie-break musi się ustalić i utrzymać
    const kolejne: number[] = [];
    for (let t = 0; t < 0.4; t += 1 / 60) {
      resolveBump(r, WALL[0], WALL[1], spec, 1 / 60);
      kolejne.push(r.yaw);
    }
    // kurs ma iść monotonicznie w jedną stronę
    const rosnie = kolejne.every((v, i) => i === 0 || v >= kolejne[i - 1] - 1e-9);
    const maleje = kolejne.every((v, i) => i === 0 || v <= kolejne[i - 1] + 1e-9);
    expect(rosnie || maleje).toBe(true);
  });

  it('koń traci na ocieraniu więcej niż maszyna w locie', () => {
    const kon = { ...newRideState(0, 0, 0, 0, MOUNT_SPECS.horse), speed: 10 };
    const maszyna = { ...newRideState(0, 30, 0, 0, spec), speed: 10 };
    for (let t = 0; t < 0.3; t += 1 / 60) {
      resolveBump(kon, WALL[0], WALL[1], MOUNT_SPECS.horse, 1 / 60);
      resolveBump(maszyna, WALL[0], WALL[1], spec, 1 / 60);
    }
    expect(kon.speed).toBeLessThan(maszyna.speed);
  });

  it('wynik rośnie z kątem natarcia', () => {
    const ostry = resolveBump(flying(Math.PI / 2 - 0.2), WALL[0], WALL[1], spec, 1 / 60);
    const czolowy = resolveBump(flying(0), WALL[0], WALL[1], spec, 1 / 60);
    expect(czolowy).toBeGreaterThan(ostry);
    expect(czolowy).toBeCloseTo(1, 1);
  });
});
