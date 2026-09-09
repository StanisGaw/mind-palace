import { describe, expect, it } from 'vitest';
import { SHELLS, basementHoles, buildingFloorHeight, buildingFloorY, buildingOpenings, facadeFloorOk, floorBaseOf, floorOfIn, orphanStairs, orphanStairsIn, stairOpenings } from './rooms';
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

describe('piwnica (poziom −1)', () => {
  const dom = (basement: boolean) => ({ ...building('house', 1), ...(basement ? { basement: true } : {}) }) as PalaceObject;

  it('piętro poniżej parteru istnieje tylko z piwnicą', () => {
    const bez = dom(false);
    const z = dom(true);
    const y = buildingFloorY(z, -1) + 0.1;
    expect(floorBaseOf(bez)).toBe(0);
    expect(floorBaseOf(z)).toBe(-1);
    expect(floorOfIn(bez, y), 'bez piwnicy wszystko ląduje na parterze').toBe(0);
    expect(floorOfIn(z, y)).toBe(-1);
  });

  it('schody z piwnicy robią otwór w stropie parteru', () => {
    const b = dom(true);
    const s: PalaceObject = { id: 's', type: 'stairs', name: 'Schody', position: [1, buildingFloorY(b, -1), 1], rotation: [0, 0, 0], scale: [1, 1, 1], anchorId: b.id };
    const openings = buildingOpenings(b, [b, s]);
    expect(openings, 'jeden strop: nad piwnicą').toHaveLength(1);
    expect(openings[0], 'otwór nad biegiem').toHaveLength(1);
    // ten sam budynek bez piwnicy nie ma stropów do wycinania
    expect(buildingOpenings(dom(false), [dom(false), s])).toEqual([]);
  });

  it('wyłączenie piwnicy kasuje bieg prowadzący z poziomu −1', () => {
    const b = dom(true);
    const s: PalaceObject = { id: 's', type: 'stairs', name: 'Schody', position: [1, buildingFloorY(b, -1), 1], rotation: [0, 0, 0], scale: [1, 1, 1], anchorId: b.id };
    // po wyłączeniu piwnicy obiekt spod ziemi liczy się jako parter, więc bieg prowadziłby w sufit
    expect(orphanStairs([dom(false), s], dom(false), 1)).toEqual(['s']);
  });

  it('elewacji nie da się postawić pod ziemią', () => {
    for (const type of ['window', 'balcony', 'terrace']) {
      expect(facadeFloorOk(type, -1), type).toBe(false);
      expect(facadeFloorOk(type, 0) || facadeFloorOk(type, 1), `${type} gdzieś nad ziemią`).toBe(true);
    }
  });

  it('płyta świata dostaje otwór wielkości wnętrza tylko pod budynkiem z piwnicą', () => {
    const b = dom(true);
    expect(basementHoles([dom(false)])).toEqual([]);
    const [h] = basementHoles([b]);
    const spec = SHELLS.house;
    expect(h.x1 - h.x0).toBeCloseTo(spec.inner.w * b.scale[0], 6);
    expect(h.z1 - h.z0).toBeCloseTo(spec.inner.d * b.scale[2], 6);
  });

  it('obrócony budynek dostaje otwór opisany na wnętrzu', () => {
    const b = { ...dom(true), rotation: [0, Math.PI / 4, 0] } as PalaceObject;
    const spec = SHELLS.house;
    const [h] = basementHoles([b]);
    const przekatna = (spec.inner.w * b.scale[0] + spec.inner.d * b.scale[2]) / Math.SQRT2;
    expect(h.x1 - h.x0).toBeCloseTo(przekatna, 4);
  });
});
