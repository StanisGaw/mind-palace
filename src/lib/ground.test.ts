import { describe, expect, it } from 'vitest';
import { GROUND_TILE, clampToGround, groundBounds, groundExtent, groundOutlines, groundRects, insideGround, isDrawnGround, outsideDistance, tileAt, tilesFromShape } from './ground';
import { clipPolygon, mergeTiles, pointInPolygon, rectPolygon, tileOutlines } from './rects';
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

  it('obrys używa każdej krawędzi dokładnie raz, także przy kaflach stykających się rogiem', () => {
    const uklady: [string, [number, number][]][] = [
      ['skos', [[0, 0], [1, 1]]],
      ['litera L', L.tiles!],
      ['klepsydra', [[0, 0], [1, 1], [2, 2], [2, 0], [0, 2]]],
      ['szachownica', [[0, 0], [1, 1], [2, 0], [3, 1], [0, 2], [1, 3]]],
      ['pojedynczy kafel', [[5, -7]]],
    ];
    for (const [nazwa, tiles] of uklady) {
      const rings = tileOutlines(tiles, GROUND_TILE);
      const uzyte = new Set<string>();
      let n = 0;
      for (const ring of rings) {
        expect(ring[0], `${nazwa}: pierścień nie jest domknięty`).toEqual(ring[ring.length - 1]);
        for (let i = 0; i + 1 < ring.length; i++) {
          const k = `${ring[i]}|${ring[i + 1]}`;
          expect(uzyte.has(k), `${nazwa}: krawędź ${k} użyta dwa razy`).toBe(false);
          uzyte.add(k);
          n++;
        }
      }
      // każdy kafel wnosi cztery krawędzie, a każdy styk bokiem zabiera dwie (styk rogiem nie zabiera żadnej)
      const have = new Set(tiles.map(([i, j]) => `${i},${j}`));
      const sasiedzi = tiles.filter(([i, j]) => have.has(`${i + 1},${j}`)).length + tiles.filter(([i, j]) => have.has(`${i},${j + 1}`)).length;
      expect(n, `${nazwa}: liczba krawędzi obrysu`).toBe(tiles.length * 4 - sasiedzi * 2);
    }
  });

  it('przynależność punktu do wielokąta łapie też kształty wklęsłe', () => {
    const kwadrat: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(pointInPolygon(kwadrat, 2, 2)).toBe(true);
    expect(pointInPolygon(kwadrat, 5, 2)).toBe(false);
    expect(pointInPolygon(kwadrat, 2, -1)).toBe(false);
    // obrócony czworokąt (obrys wnętrza budynku pod kątem)
    const romb: [number, number][] = [[0, -3], [3, 0], [0, 3], [-3, 0]];
    expect(pointInPolygon(romb, 0, 0)).toBe(true);
    expect(pointInPolygon(romb, 2.5, 2.5), 'róg opisanego kwadratu jest poza rombem').toBe(false);
    // wklęsły: litera L
    const el: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    expect(pointInPolygon(el, 1, 3)).toBe(true);
    expect(pointInPolygon(el, 3, 3), 'wycięty róg litery L').toBe(false);
  });

  it('otwór przycięty do planszy nie wystaje poza jej obrys', () => {
    const plansza: [number, number][] = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const wSrodku: [number, number][] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
    expect(clipPolygon(wSrodku, plansza), 'otwór w całości na planszy zostaje bez zmian').toEqual(wSrodku);
    // otwór wystający poza planszę zostaje przycięty do jej krawędzi
    const naKrawedzi = clipPolygon([[6, -2], [14, -2], [14, 2], [6, 2]], plansza);
    expect(Math.max(...naKrawedzi.map(([x]) => x))).toBeCloseTo(10, 6);
    expect(clipPolygon([[20, 20], [24, 20], [24, 24]], plansza), 'otwór poza planszą znika').toEqual([]);
    // ten sam mechanizm dla planszy z kafli: tniemy po prostokątach
    const kafel = rectPolygon({ x0: 0, x1: 4, z0: 0, z1: 4 });
    expect(clipPolygon([[2, 2], [8, 2], [8, 6], [2, 6]], kafel).length).toBeGreaterThan(2);
  });

  it('scalanie jest odporne na powtórzone kafle', () => {
    expect(mergeTiles([[0, 0], [0, 0], [1, 0]], 4)).toEqual([{ x0: 0, x1: 8, z0: 0, z1: 4 }]);
  });
});
