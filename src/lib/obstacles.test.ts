/**
 * Przeszkody dla zwierząt i wierzchowców: obrys obiektu to obrócony prostokąt z wysokością. Dawniej
 * przeszkoda była kołem o promieniu z katalogu, więc zwierzęta i jeźdźcy przechodzili przez narożniki
 * budynków, a lot nad dachem nie różnił się od wjazdu w ścianę.
 */
import { describe, expect, it } from 'vitest';
import { contact, insideAny, pushOut, steerAway, type Obstacle } from './obstacles';

const house: Obstacle = { id: 'h', x: 10, z: 0, yaw: 0, hx: 4, hz: 3, bottom: 0, top: 6 };
const turned: Obstacle = { id: 't', x: 0, z: 0, yaw: Math.PI / 4, hx: 4, hz: 1, bottom: 0, top: 3 };

describe('kontakt z przeszkodą', () => {
  it('liczy odległość od brzegu i kierunek na zewnątrz', () => {
    const c = contact(house, 10, 5);
    expect(c.dist).toBeCloseTo(2, 5);
    expect(c.nz).toBeCloseTo(1, 5);
    const corner = contact(house, 17, 7);
    expect(corner.dist).toBeCloseTo(5, 5);
  });

  it('wewnątrz wychodzi przez bliższą ścianę', () => {
    const c = contact(house, 13.5, 0);
    expect(c.dist).toBeCloseTo(-0.5, 5);
    expect(c.nx).toBeCloseTo(1, 5);
    expect(c.nz).toBeCloseTo(0, 5);
  });

  it('uwzględnia obrót obiektu', () => {
    // wzdłuż lokalnej osi X obróconej o 45°: punkt 5 m od środka leży 1 m za krawędzią
    const [x, z] = [Math.cos(Math.PI / 4) * 5, -Math.sin(Math.PI / 4) * 5];
    expect(contact(turned, x, z).dist).toBeCloseTo(1, 4);
    // prostopadle (lokalna oś Z) krawędź jest 1 m od środka
    const [px, pz] = [Math.sin(Math.PI / 4) * 3, Math.cos(Math.PI / 4) * 3];
    expect(contact(turned, px, pz).dist).toBeCloseTo(2, 4);
  });
});

describe('wypychanie', () => {
  it('wypycha punkt poza obrys z marginesem i zgłasza, o co się otarł', () => {
    const r = pushOut(13, 0, [house], 0.5);
    expect(r.x).toBeCloseTo(14.5, 5);
    expect(r.hit?.id).toBe('h');
    const free = pushOut(20, 0, [house], 0.5);
    expect(free.hit).toBeNull();
    expect(free.x).toBe(20);
  });

  it('nad szczytem przelatuje się swobodnie, poniżej — zderzenie', () => {
    expect(pushOut(10, 0, [house], 0.5, 7).hit).toBeNull();
    expect(pushOut(10, 0, [house], 0.5, 3).hit?.id).toBe('h');
  });

  it('pomija własny obiekt jeźdźca', () => {
    expect(pushOut(10, 0, [house], 0.5, undefined, 'h').hit).toBeNull();
  });

  it('insideAny widzi punkt w obrysie z marginesem', () => {
    expect(insideAny(14.3, 0, [house], 0.5)).toBe(true);
    expect(insideAny(14.6, 0, [house], 0.5)).toBe(false);
  });
});

describe('odpychanie', () => {
  it('kieruje od najbliższej ściany i gaśnie z odległością', () => {
    const [sx, sz] = steerAway(10, 3.5, [house], 1.5);
    expect(sz).toBeGreaterThan(0.5);
    expect(Math.abs(sx)).toBeLessThan(1e-6);
    const [fx, fz] = steerAway(10, 6, [house], 1.5);
    expect(fx).toBe(0);
    expect(fz).toBe(0);
  });
});

describe('pasma wysokości', () => {
  // wieża schodkowa: cokół 12 x 12 do 4 m, trzon 6 x 6 do 30 m
  const wieza: Obstacle = {
    id: 'w', x: 0, z: 0, yaw: 0, hx: 6, hz: 6, bottom: 0, top: 30,
    slices: [
      { top: 4, x: 0, z: 0, hx: 6, hz: 6 },
      { top: 30, x: 0, z: 0, hx: 3, hz: 3 },
    ],
  };

  it('przy ziemi liczy się obrys cokołu', () => {
    expect(contact(wieza, 7, 0, 2).dist).toBeCloseTo(1, 4);
  });

  it('wyżej liczy się węższy trzon — tam, gdzie cokół blokował, jest wolno', () => {
    expect(contact(wieza, 7, 0, 20).dist).toBeCloseTo(4, 4);
  });

  it('bez podanej wysokości zostaje obrys całej bryły', () => {
    expect(contact(wieza, 7, 0).dist).toBeCloseTo(1, 4);
  });

  it('ponad ostatnim pasmem obowiązuje pasmo najwyższe', () => {
    expect(contact(wieza, 7, 0, 99).dist).toBeCloseTo(4, 4);
  });

  it('przelot obok trzonu nie jest wypychany, przy cokole jest', () => {
    const gora = pushOut(5, 0, [wieza], 1, 20);
    expect(gora.hit).toBeNull();
    expect(gora.x).toBeCloseTo(5, 4);
    const dol = pushOut(5, 0, [wieza], 1, 2);
    expect(dol.hit).not.toBeNull();
    expect(dol.x).toBeCloseTo(7, 4);
  });
});
