import { describe, expect, it } from 'vitest';
import { WALL_SEGMENT, mergePathObjects, mergeablePaths, wallLength } from './rooms';
import { normalizePalace } from './storage';
import type { PalaceObject, Vec3 } from '../types';

/**
 * Ścieżki rysuje się odcinkami, często w kilku sesjach i jedna na drugiej. Scalanie ma z tego zrobić
 * jeden obiekt tam, gdzie odcinki leżą w jednej linii, i wspólną grupę tam, gdzie ciągi stykają się końcami —
 * tak, jakby wszystko powstało za jednym razem.
 */

let n = 0;
/** Odcinek ścieżki od `x0` do `x1` na osi X (obrót 0 biegnie wzdłuż +X). */
function path(x0: number, x1: number, extra: Partial<PalaceObject> = {}): PalaceObject {
  const len = Math.abs(x1 - x0);
  return {
    id: `p${n++}`,
    type: 'pathway',
    name: 'Ścieżka',
    position: [(x0 + x1) / 2, 0, 0],
    rotation: [0, 0, 0],
    scale: [len / WALL_SEGMENT, 1, 1] as Vec3,
    ...extra,
  };
}

const ids = () => {
  let k = 0;
  return () => `g${k++}`;
};

describe('scalanie ścieżek', () => {
  it('odcinek narysowany dokładnie na drugim znika — zostaje jeden', () => {
    const { objects, gone } = mergePathObjects([path(0, 6), path(0, 6)], ids());
    expect(gone).toHaveLength(1);
    expect(objects).toHaveLength(1);
    expect(wallLength(objects[0])).toBeCloseTo(6, 6);
  });

  it('odcinki częściowo nachodzące dają jeden o długości sumy minus zakładka', () => {
    const { objects } = mergePathObjects([path(0, 6), path(4, 10)], ids());
    expect(objects).toHaveLength(1);
    expect(wallLength(objects[0])).toBeCloseTo(10, 6);
    expect(objects[0].position[0]).toBeCloseTo(5, 6);
  });

  it('różna szerokość albo nawierzchnia nie scala się', () => {
    const szeroka = path(0, 6, { scale: [6 / WALL_SEGMENT, 1, 2] as Vec3 });
    expect(mergeablePaths(path(0, 6), szeroka)).toBe(false);
    expect(mergePathObjects([path(0, 6), szeroka], ids()).objects).toHaveLength(2);

    const zwir = path(0, 6, { finish: { floor: 'gravel' } });
    const deski = path(4, 10, { finish: { floor: 'planks' } });
    expect(mergeablePaths(zwir, deski)).toBe(false);
    expect(mergePathObjects([zwir, deski], ids()).objects).toHaveLength(2);
  });

  it('odcinka z notatką nigdy nie kasujemy', () => {
    const note = { title: 'Tu', body: '', createdAt: 0, updatedAt: 0, srs: { interval: 1, ease: 2.5, due: 0, reps: 0, lapses: 0 } };
    const { objects, gone } = mergePathObjects([path(0, 6, { note }), path(0, 6)], ids());
    expect(gone).toHaveLength(0);
    expect(objects).toHaveLength(2);
  });

  it('ścieżki pod kątem prostym nie scalają się, ale dostają wspólną grupę', () => {
    const wzdluzX = path(0, 6);
    const wzdluzZ: PalaceObject = { ...path(0, 6), id: 'z', position: [6, 0, 3], rotation: [0, Math.PI / 2, 0] };
    const { objects } = mergePathObjects([wzdluzX, wzdluzZ], ids());
    expect(objects).toHaveLength(2);
    expect(objects[0].groupId, 'ciąg powinien mieć wspólną grupę').toBeTruthy();
    expect(objects[0].groupId).toBe(objects[1].groupId);
  });

  it('ciągi z dwóch sesji stykające się końcami dostają jedną grupę', () => {
    const a: PalaceObject = { ...path(0, 6), groupId: 'sesja-1' };
    const b: PalaceObject = { ...path(0, 6), id: 'b', position: [6, 0, 3], rotation: [0, Math.PI / 2, 0], groupId: 'sesja-2' };
    const { objects } = mergePathObjects([a, b], ids());
    expect(new Set(objects.map((o) => o.groupId)).size, 'jedna grupa na cały ciąg').toBe(1);
  });

  it('scalanie jest idempotentne', () => {
    const first = mergePathObjects([path(0, 6), path(4, 10), path(10, 14)], ids());
    const second = mergePathObjects(first.objects, ids());
    expect(second.gone).toHaveLength(0);
    expect(second.objects).toEqual(first.objects);
  });

  it('samotna ścieżka nie dostaje grupy ani nie znika', () => {
    const { objects, gone } = mergePathObjects([path(0, 6)], ids());
    expect(gone).toHaveLength(0);
    expect(objects[0].groupId).toBeUndefined();
  });
});

describe('migracja przy wczytaniu', () => {
  it('stary pałac z nachodzącymi ścieżkami wczytuje się już scalony i bez martwych id w ścieżce pamięci', () => {
    const a = path(0, 6);
    const b = path(4, 10);
    const p = normalizePalace({ id: 'x', name: 'Stary', objects: [a, b], path: [a.id, b.id] });
    expect(p.objects.filter((o) => o.type === 'pathway')).toHaveLength(1);
    const alive = new Set(p.objects.map((o) => o.id));
    expect(p.path.every((id) => alive.has(id)), 'ścieżka pamięci wskazuje tylko istniejące obiekty').toBe(true);
  });
});
