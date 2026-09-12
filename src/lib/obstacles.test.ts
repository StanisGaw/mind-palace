/**
 * Przeszkody dla zwierząt i wierzchowców: obrys obiektu to obrócony prostokąt z wysokością. Dawniej
 * przeszkoda była kołem o promieniu z katalogu, więc zwierzęta i jeźdźcy przechodzili przez narożniki
 * budynków, a lot nad dachem nie różnił się od wjazdu w ścianę.
 */
import { describe, expect, it } from 'vitest';
import { avoid, contact, insideAny, pushOut, type Obstacle } from './obstacles';

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

describe('avoid — obejście zamiast stania pod murem', () => {
  // ściana 10 x 2 wzdłuż osi X, środek w (0,0)
  const mur: Obstacle = { id: 'm', x: 0, z: 0, yaw: 0, hx: 5, hz: 1, bottom: 0, top: 4 };
  const dlugosc = ([x, z]: [number, number]) => Math.hypot(x, z);

  it('idąc prosto na ścianę zwierzę dostaje kierunek wzdłuż niej, a nie zerowy', () => {
    // stoi 1,2 m przed ścianą i chce iść na nią (w −Z)
    const [x, z] = avoid(0, 2.2, 0, -1, [mur], 1.6, 1);
    expect(dlugosc([x, z])).toBeCloseTo(1, 4); // nie zeruje się — to był objaw stania w miejscu
    expect(Math.abs(x)).toBeGreaterThan(0.5); // idzie w bok, czyli obchodzi
  });

  it('bliżej ściany kierunek jest bardziej równoległy do niej', () => {
    const daleko = avoid(0, 2.5, 0, -1, [mur], 1.6, 1);
    const blisko = avoid(0, 1.1, 0, -1, [mur], 1.6, 1);
    expect(Math.abs(blisko[0])).toBeGreaterThan(Math.abs(daleko[0]));
  });

  it('obchodzi tą stroną, w którą i tak zmierza', () => {
    const wPrawo = avoid(0, 2.2, 0.4, -1, [mur], 1.6, 1);
    const wLewo = avoid(0, 2.2, -0.4, -1, [mur], 1.6, 1);
    expect(wPrawo[0]).toBeGreaterThan(0);
    expect(wLewo[0]).toBeLessThan(0);
  });

  it('bryła za plecami niczego nie zmienia', () => {
    const [x, z] = avoid(0, 2.2, 0, 1, [mur], 1.6, 1);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
  });

  it('z dala od przeszkód kierunek zostaje nietknięty', () => {
    const [x, z] = avoid(0, 20, 0, -1, [mur], 1.6, 1);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-1, 6);
  });

  it('nad szczytem ściany nic nie przeszkadza', () => {
    const [x, z] = avoid(0, 2.2, 0, -1, [mur], 1.6, 9);
    expect(z).toBeCloseTo(-1, 6);
  });

  it('brak kierunku daje brak wyniku', () => {
    expect(avoid(0, 2.2, 0, 0, [mur], 1.6, 1)).toEqual([0, 0]);
  });

  it('wynik jest zawsze jednostkowy', () => {
    for (const [px, pz] of [[0, 2.2], [3, 1.5], [-4.5, 1.2], [5.5, 0]]) {
      for (const [dx, dz] of [[0, -1], [1, -1], [-1, -0.2]]) {
        const r = avoid(px, pz, dx, dz, [mur], 1.6, 1);
        expect(dlugosc(r)).toBeCloseTo(1, 4);
      }
    }
  });

  /** Przejście zwierzęcia do celu: `avoid` co krok, wypychanie jak w scenie. Zwraca punkt po `kroki` krokach. */
  function wedruj(startX: number, kroki = 500) {
    let x = startX;
    let z = 2.2;
    let vx = 0;
    let vz = -1;
    for (let i = 0; i < kroki; i++) {
      [vx, vz] = avoid(x, z, 0 - x, -6 - z, [mur], 1.6, 1, vx, vz);
      x += vx * 0.05;
      z += vz * 0.05;
      const c = contact(mur, x, z, 1);
      if (c.dist < 0.2) {
        x += c.nx * (0.2 - c.dist);
        z += c.nz * (0.2 - c.dist);
      }
    }
    return { x, z };
  }

  it('cel schowany za murem: zwierzę obchodzi go i dochodzi, zamiast tkwić pod ścianą', () => {
    // mur ma 10 m długości, cel leży dokładnie za jego środkiem — najgorszy możliwy układ
    const { z } = wedruj(0);
    expect(z).toBeLessThan(-5.5);
  });

  it('obchodzi niezależnie od tego, z której strony podchodzi', () => {
    for (const start of [-2, 0.5, 3]) expect(wedruj(start).z).toBeLessThan(-5.5);
  });

  it('nie drga w lewo i w prawo: na całej trasie najwyżej jedna zmiana strony', () => {
    // objawem starego zachowania było drganie wokół osi celu — dziesiątki zmian znaku na sekundę.
    // Jedna zmiana jest w porządku: po minięciu narożnika zwierzę wraca kursem do celu.
    let x = 0;
    let z = 2.2;
    let vx = 0;
    let vz = -1;
    let zmiany = 0;
    let poprzedni = 0;
    for (let i = 0; i < 300; i++) {
      [vx, vz] = avoid(x, z, 0 - x, -6 - z, [mur], 1.6, 1, vx, vz);
      x += vx * 0.05;
      z += vz * 0.05;
      const c = contact(mur, x, z, 1);
      if (c.dist < 0.2) {
        x += c.nx * (0.2 - c.dist);
        z += c.nz * (0.2 - c.dist);
      }
      const znak = Math.sign(Math.abs(vx) > 0.1 ? vx : 0);
      if (znak !== 0 && poprzedni !== 0 && znak !== poprzedni) zmiany++;
      if (znak !== 0) poprzedni = znak;
      if (Math.hypot(x, z + 6) < 0.5) break; // u celu zwierzę staje, więc dalej nie ma czego liczyć
    }
    expect(zmiany).toBeLessThanOrEqual(1);
  });
});
