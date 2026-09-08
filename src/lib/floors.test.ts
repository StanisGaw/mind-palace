import { describe, expect, it } from 'vitest';
import { SHELLS, buildingFloorHeight, buildingFloorY, buildingOpenings, orphanStairs, orphanStairsIn, stairOpenings } from './rooms';
import { findStairsSpot } from './layout';
import { ROOMS } from '../catalog';
import type { PalaceObject, Vec3 } from '../types';

/**
 * Piętra i schody: usunięcie kondygnacji ma zabrać ze sobą bieg, który prowadziłby w sufit, razem
 * z otworem w stropie. Wcześniej blokada patrzyła tylko na obiekty stojące na znikającym piętrze,
 * a schody stoją piętro niżej — zostawały schody donikąd.
 */

function building(type: string, floors: number, scale = SHELLS[type].minScale): PalaceObject {
  return { id: `b-${type}`, type, name: type, position: [0, 0, 0], rotation: [0, 0, 0], scale: [scale, scale, scale] as Vec3, interiorMode: 'inplace', shellVersion: 5, floors };
}

/** Schody z biblioteki postawione w budynku tak, jak robi to `addStairsTo`. */
function stairsIn(b: PalaceObject, floor: number, id = 's1'): PalaceObject {
  const spot = findStairsSpot(b, [b]);
  if (!spot) throw new Error(`${b.type}: brak miejsca na schody`);
  const y = buildingFloorY(b, floor);
  return { id, type: 'stairs', name: 'Schody', position: [spot.position[0], y, spot.position[2]], rotation: [0, spot.rotationY, 0], scale: [1, 1, 1], anchorId: b.id };
}

describe('schody znikają razem z piętrem', () => {
  for (const type of ['house', 'palace', 'library'] as const) {
    it(`${type}: zejście do parteru kasuje bieg i otwór w stropie`, () => {
      const b = building(type, 2);
      const s = stairsIn(b, 0);
      const objects = [b, s];
      expect(buildingOpenings(b, objects)[0], 'przy dwóch piętrach otwór ma być').toHaveLength(1);
      expect(orphanStairs(objects, b, 1)).toEqual([s.id]);
      const zostaje = objects.filter((o) => !orphanStairs(objects, b, 1).includes(o.id));
      const parter = { ...b, floors: 1 };
      expect(zostaje.some((o) => o.type === 'stairs'), 'schody miały zniknąć').toBe(false);
      expect(buildingOpenings(parter, zostaje), 'przy jednym piętrze nie ma stropów').toEqual([]);
    });
  }

  it('bieg, który dalej dokądś prowadzi, zostaje', () => {
    const b = building('palace', 2);
    const s = stairsIn(b, 0);
    expect(orphanStairs([b, s], b, 2), 'schody z parteru na piętro są potrzebne').toEqual([]);
  });

  it('z trzech kondygnacji znika tylko górny bieg', () => {
    const b = building('tower', 3);
    // wieża ma bieg wbudowany w mur, więc do testu wstawiamy schody „ręcznie", tak jak zrobiłby to użytkownik
    const H = buildingFloorHeight(b);
    const mk = (floor: number, id: string): PalaceObject => ({ id, type: 'stairs', name: 'Schody', position: [0, buildingFloorY(b, 0) + floor * H, 0], rotation: [0, 0, 0], scale: [1, 1, 1], anchorId: b.id });
    const dol = mk(0, 'dol');
    const gora = mk(1, 'gora');
    expect(orphanStairs([b, dol, gora], b, 2)).toEqual(['gora']);
    expect(orphanStairs([b, dol, gora], b, 3)).toEqual([]);
  });

  it('piętra w górę i w dół nie mnożą schodów ani otworów', () => {
    const b = building('house', 1);
    let objects: PalaceObject[] = [b];
    for (const floors of [2, 1, 2, 1, 2]) {
      const bb = { ...b, floors };
      const gone = new Set(orphanStairs(objects, bb, floors));
      objects = objects.filter((o) => !gone.has(o.id)).map((o) => (o.id === b.id ? bb : o));
      // tak jak w magazynie: schody dokładamy tylko wtedy, gdy piętro powstało i biegu jeszcze nie ma
      if (floors > 1 && !objects.some((o) => o.type === 'stairs')) objects.push(stairsIn(bb, 0, `s${floors}`));
      const biegi = objects.filter((o) => o.type === 'stairs');
      const otwory = buildingOpenings(bb, objects).flat();
      expect(biegi, `${floors} kondygnacji: liczba biegów`).toHaveLength(floors > 1 ? 1 : 0);
      expect(otwory, `${floors} kondygnacji: liczba otworów`).toHaveLength(floors > 1 ? 1 : 0);
    }
  });

  it('wieża nie dostaje schodów z biblioteki — ma bieg w murze', () => {
    expect(findStairsSpot(building('tower', 3), [])).toBeNull();
  });
});

describe('schody w pokoju ładowanym osobno', () => {
  const H = ROOMS.house.height;
  const mk = (floor: number, id: string): PalaceObject => ({ id, type: 'stairs', name: 'Schody', position: [1, floor * H, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });

  it('zejście do parteru kasuje bieg i otwór', () => {
    const s = mk(0, 's');
    expect(stairOpenings([s], H)[0], 'przy dwóch piętrach otwór ma być').toHaveLength(1);
    expect(orphanStairsIn([s], H, 1)).toEqual(['s']);
    expect(stairOpenings([], H), 'bez schodów nie ma otworów').toEqual([]);
  });

  it('bieg prowadzący na istniejące piętro zostaje', () => {
    expect(orphanStairsIn([mk(0, 's')], H, 2)).toEqual([]);
    expect(orphanStairsIn([mk(1, 'g')], H, 2)).toEqual(['g']);
  });
});
