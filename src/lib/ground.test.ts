import { describe, expect, it } from 'vitest';
import { GROUND_TILE, clampToGround, groundBounds, groundExtent, groundOutlines, groundRects, insideGround, isDrawnGround, outsideDistance, tileAt, tilesFromShape } from './ground';
import { mergeTiles } from './rects';
import type { GroundSpec } from '../types';

/**
 * Narysowana plansza: kafle scalane w prostokąty (kolidery i linie siatki), obrys do rysowania boku płyty
 * oraz przynależność punktu. Płyta przestała być wielokątem wypukłym, więc te trzy rzeczy muszą się zgadzać.
 */

/** Litera L: kwadrat 2 × 2 kafle plus ramię w prawo na dole. */
const L: GroundSpec = { width: 0, depth: 0, shape: 'rect', tiles: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [3, 1]] };

describe('plansza z kafli', () => {
  it('kafle scalają się w możliwie duże prostokąty i pokrywają dokładnie te same pola', () => {
    const rects = groundRects(L);
    expect(rects.length, `${rects.length} prostokątów`).toBeLessThanOrEqual(3);
    const pole = rects.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    expect(pole).toBeCloseTo(L.tiles!.length * GROUND_TILE * GROUND_TILE, 6);
    // każdy kafel leży w dokładnie jednym prostokącie (brak nakładania)
    for (const [i, j] of L.tiles!) {
      const cx = (i + 0.5) * GROUND_TILE;
      const cz = (j + 0.5) * GROUND_TILE;
      const w = rects.filter((r) => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1);
      expect(w, `kafel ${i},${j} w ${w.length} prostokątach`).toHaveLength(1);
    }
  });

  it('przynależność punktu zgadza się z kaflami', () => {
    const has = new Set(L.tiles!.map(([i, j]) => `${i},${j}`));
    for (let n = 0; n < 200; n++) {
      const x = (Math.random() - 0.3) * 30;
      const z = (Math.random() - 0.3) * 30;
      expect(insideGround(L, x, z), `(${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(has.has(tileAt(x, z).join(',')));
    }
  });

  it('punkt spoza planszy trafia po dociągnięciu do środka planszy', () => {
    for (const [x, z] of [[-20, -20], [40, 4], [6, 40], [0, 1e4]]) {
      const [px, pz] = clampToGround(L, x, z, 0.8);
      expect(insideGround(L, px, pz), `(${x}, ${z}) → (${px.toFixed(2)}, ${pz.toFixed(2)})`).toBe(true);
    }
  });

  it('obrys ma jeden pierścień, a plansza z dziurą w środku dwa', () => {
    expect(groundOutlines(L)).toHaveLength(1);
    const pierscien: GroundSpec = { width: 0, depth: 0, shape: 'rect', tiles: [] };
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) pierscien.tiles!.push([i, j]);
    expect(groundOutlines(pierscien)).toHaveLength(2);
  });

  it('kształt przepisany na kafle pokrywa mniej więcej to samo pole', () => {
    const rect: GroundSpec = { width: 40, depth: 24, shape: 'rect' };
    const tiles = tilesFromShape(rect);
    expect(isDrawnGround({ ...rect, tiles })).toBe(true);
    expect(tiles.length * GROUND_TILE * GROUND_TILE).toBeCloseTo(40 * 24, -2);
  });

  it('zasięg i obrys liczą się z kafli, nie z suwaków', () => {
    const b = groundBounds(L);
    expect([b.x0, b.x1, b.z0, b.z1]).toEqual([0, 16, 0, 8]);
    expect(groundExtent(L)).toBe(16);
    expect(outsideDistance(L, 18, 4)).toBeCloseTo(2, 6);
    expect(outsideDistance(L, 4, 4)).toBe(0);
  });

  it('scalanie jest odporne na powtórzone kafle', () => {
    expect(mergeTiles([[0, 0], [0, 0], [1, 0]], 4)).toEqual([{ x0: 0, x1: 8, z0: 0, z1: 4 }]);
  });
});
