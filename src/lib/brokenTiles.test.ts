import { describe, expect, it } from 'vitest';
import type { PalaceObject } from '../types';
import { brokenTileText, describeBrokenTile, gridTileAt, isBrokenTile, makeBrokenTile } from './brokenTiles';

function obj(id: string, type: string, x: number, z: number): PalaceObject {
  return { id, type, name: type, position: [x, 0, z], rotation: [0, 0.5, 0], scale: [1.2, 1.2, 1.2] };
}

describe('brokenTiles', () => {
  it('kafel siatki metrowej zaokrągla w dół także dla ujemnych współrzędnych', () => {
    expect(gridTileAt(5.3, -6.2)).toEqual([5, -7]);
    expect(gridTileAt(-0.1, 0)).toEqual([-1, 0]);
  });

  it('zgłoszenie zapisuje najbliższych sąsiadów rosnąco po odległości i pomija dalekie obiekty', () => {
    const objects = [obj('far', 'tree', 30, 30), obj('bush', 'bush', 3.4, -3), obj('bench', 'bench', 5, -4.6)];
    const t = makeBrokenTile([5.27, 0, -6.02], objects, 'b1', 123);
    expect(t.tile).toEqual([5, -7]);
    expect(t.point).toEqual([5.27, 0, -6.02]);
    expect(t.createdAt).toBe(123);
    expect(t.nearby.map((n) => n.id)).toEqual(['bench', 'bush']);
    expect(t.nearby[0]).toMatchObject({ type: 'bench', distance: 1.45, rotationY: 0.5, scale: [1.2, 1.2, 1.2] });
  });

  it('opis pokazuje kafel z minusem typograficznym', () => {
    const t = makeBrokenTile([5.27, 0, -6.02], [], 'b1');
    expect(describeBrokenTile(t)).toBe('kafel (5, −7)');
  });

  it('tekst do schowka zawiera nazwę pałacu i całe zgłoszenie', () => {
    const t = makeBrokenTile([1, 0, 2], [obj('a', 'bush', 1, 2)], 'b1', 5);
    const parsed = JSON.parse(brokenTileText({ id: 'p1', name: 'Wioska', interior: undefined }, t));
    expect(parsed.palace).toEqual({ id: 'p1', name: 'Wioska' });
    expect(parsed.brokenTile).toEqual(t);
  });

  it('odrzuca wpisy bez punktu', () => {
    expect(isBrokenTile({ id: 'x', point: [1, 2, 3] })).toBe(true);
    expect(isBrokenTile({ id: 'x', point: [1, 2] })).toBe(false);
    expect(isBrokenTile({ id: 'x', point: [1, NaN, 3] })).toBe(false);
    expect(isBrokenTile(null)).toBe(false);
  });
});
