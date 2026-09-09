import { describe, expect, it } from 'vitest';
import { FURNITURE_SETS, SET_WALL_GAP, instantiateSet } from './sets';
import { SHELLS, buildingFloorY } from './rooms';
import { PLAYER_R, WalkGrid, boxCorners, boxPoint, boxesOverlap, findStairsSpot, insideRoom, layoutProblems, obstacleOf, placementBlock, pointInBox, roomOfBuilding, stairBoxes, type Box2, type RoomShape } from './layout';
import type { FurnitureSet, PalaceObject, Vec3 } from '../types';

/**
 * Testy integracyjne układów pokoi: każdy wbudowany układ musi dać się użyć — gracz (kapsuła o promieniu
 * 0,32 m) wchodzi drzwiami, dochodzi do każdego mebla i do schodów, a schody mają bieg, podejście i podest
 * w pokoju, bez przecinania ścian.
 */

const TYPES = ['house', 'palace', 'library', 'temple', 'tower'] as const;

/** Budynek z wnętrzem w miejscu w podanej skali (domyślnie najmniejszej dopuszczalnej). */
function building(type: string, scale?: number, yaw = 0, floors?: number): PalaceObject {
  const s = scale ?? SHELLS[type].minScale;
  return {
    id: `b-${type}`,
    type,
    name: type,
    position: [0, 0, 0],
    rotation: [0, yaw, 0],
    scale: [s, s, s] as Vec3,
    interiorMode: 'inplace',
    shellVersion: 5,
    floors: floors ?? SHELLS[type].defaultFloors,
  };
}

describe('powierzchnia budynków', () => {
  it('wnętrze mieści klatkę schodową z podejściem i podestem', () => {
    for (const type of TYPES) {
      const spec = SHELLS[type];
      const b = building(type);
      const room = roomOfBuilding(b);
      const need = 1.15 * room.floorHeight + 0.55 * 2 + 0.75 * 2; // bieg + podejście + podest
      const longer = Math.max(spec.inner.w * b.scale[0], spec.inner.d * b.scale[2]);
      if (type === 'temple') continue; // świątynia jest jednokondygnacyjna
      expect(longer, `${type}: dłuższy bok ${longer.toFixed(2)} m nie mieści biegu ${need.toFixed(2)} m`).toBeGreaterThan(need);
    }
  });

  it('każdy budynek ma co najmniej 30 m² podłogi w najmniejszej skali', () => {
    for (const type of TYPES) {
      const b = building(type);
      const spec = SHELLS[type];
      // w wieży liczy się wolne koło wewnątrz pierścienia kręconych schodów, nie całe wnętrze muru
      const area = type === 'tower' ? Math.PI * (roomOfBuilding(b).radius ?? 0) ** 2 : spec.inner.w * b.scale[0] * spec.inner.d * b.scale[2];
      expect(area, `${type}: ${area.toFixed(1)} m²`).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('schody dodane z panelem pięter', () => {
  for (const type of ['house', 'palace', 'library'] as const) {
    for (const scale of [SHELLS[type].minScale, SHELLS[type].minScale * 1.5]) {
      it(`${type} (skala ${scale}): schody mieszczą się przy murze, z podejściem i podestem`, () => {
        const b = building(type, scale, 0.7, 2);
        const spot = findStairsSpot(b, [b]);
        expect(spot, 'nie znaleziono miejsca na schody').not.toBeNull();
        const room = roomOfBuilding(b);
        const stairs = { position: spot!.position, rotation: [0, spot!.rotationY, 0] as Vec3, scale: [1, 1, 1] as Vec3 };
        const { steps, approach, landing } = stairBoxes(stairs, room.floorHeight);
        for (const [label, box] of [['bieg', steps], ['podejście', approach], ['podest', landing]] as const) {
          for (const [x, z] of boxCorners(box)) {
            expect(insideRoom(room, x, z, 0.05), `${label} wychodzi poza pokój w (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(true);
          }
        }
      });
    }
  }

  it('schody nie zastawiają wejścia ani drzwi ścianki', () => {
    const b = building('palace', SHELLS.palace.minScale, 0, 2);
    const objects = [b, ...placeSetIn(FURNITURE_SETS.find((s) => s.id === 'jadalnia')!, roomOfBuilding(b), buildingFloorY(b, 0))];
    const spot = findStairsSpot(b, objects);
    expect(spot).not.toBeNull();
    const room = roomOfBuilding(b);
    const stairs = { position: spot!.position, rotation: [0, spot!.rotationY, 0] as Vec3, scale: [1, 1, 1] as Vec3 };
    const { steps, approach, landing } = stairBoxes(stairs, room.floorHeight);
    for (const w of objects.filter((o) => o.type === 'wall')) {
      for (const piece of obstacleOf(w, objects, room.floorHeight)) {
        expect(boxesOverlap(steps, piece), 'schody przecinają ściankę działową').toBe(false);
      }
    }
    // wejście do budynku i światło drzwi ścianek muszą zostać wolne
    for (const box of [steps, approach, landing]) {
      expect(pointInBox(box, room.entry[0], room.entry[1], 0.5), 'schody zastawiają wejście').toBe(false);
    }
    for (const d of objects.filter((o) => o.type === 'door')) {
      expect(pointInBox(steps, d.position[0], d.position[2], 0.9), 'schody stoją w świetle drzwi').toBe(false);
    }
    // do dołu schodów da się dojść od wejścia
    const obstacles = objects.filter((o) => o.id !== b.id).flatMap((o) => obstacleOf(o, objects, room.floorHeight));
    const grid = new WalkGrid(room, [...obstacles, steps]);
    const seen = grid.reachable(room.entry[0], room.entry[1]);
    expect(grid.near(seen, approach.cx, approach.cz, 0.35), 'nie da się dojść do schodów od wejścia').toBe(true);
  });
});

/** Zestaw postawiony w pokoju: tyłem do ściany −Z, przesunięty wzdłuż niej o `offset`, jak przyciąganie podglądu. */
function placeSetIn(set: FurnitureSet, room: RoomShape, baseY = 0, offset = 0): PalaceObject[] {
  const lz = set.back ? -room.box.hz + set.depth / 2 + SET_WALL_GAP : 0;
  return instantiateSet(set, ((n) => () => `s${n++}`)(0)).map((o) => {
    const [x, z] = boxPoint(room.box, o.position[0] + offset, o.position[2] + lz);
    return { ...o, position: [x, baseY + o.position[1], z] as Vec3, rotation: [0, o.rotation[1] + room.box.yaw, 0] as Vec3 };
  });
}

/** Pokój dokładnie pod zestaw: tył przy ścianie (obrazy mają na czym wisieć), z przodu miejsce na wejście. */
function roomForSet(set: FurnitureSet): RoomShape {
  const side = 0.8;
  const front = set.back ? side : side + 1.2;
  const back = set.back ? SET_WALL_GAP : side + 1.2;
  const hz = (set.depth + front + back) / 2;
  const box: Box2 = { cx: 0, cz: -set.depth / 2 - back + hz, hx: set.width / 2 + side, hz, yaw: 0 };
  return { box, floorHeight: 3.2, entry: [box.cx, box.cz + hz - 0.7] };
}

describe('wbudowane zestawy mebli', () => {
  for (const set of FURNITURE_SETS) {
    it(`„${set.name}" w pokoju na swoją miarę: nic nie nachodzi i do wszystkiego da się dojść`, () => {
      const room = roomForSet(set);
      const problems = layoutProblems(room, placeSetIn(set, room), 1);
      expect(problems, problems.join('\n')).toEqual([]);
    });

    it(`„${set.name}" mieści się w swoim obrysie ${set.width} × ${set.depth} m`, () => {
      const objects = placeSetIn(set, { box: { cx: 0, cz: 0, hx: set.width / 2, hz: set.depth / 2, yaw: 0 }, floorHeight: 3.2, entry: [0, 0] });
      for (const o of objects) {
        for (const b of obstacleOf(o, objects, 3.2)) {
          for (const [x, z] of boxCorners(b)) {
            expect(Math.abs(x) <= set.width / 2 + 0.01 && Math.abs(z) <= set.depth / 2 + 0.01, `${o.type} wystaje poza obrys w (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(true);
          }
        }
      }
    });
  }

  // Zestawy wnętrz w prawdziwych budynkach. Zestaw wolno przesuwać wzdłuż ściany (obraz nie może zasłonić
  // wbudowanego okna), więc wymagamy, żeby dało się go postawić w którymkolwiek miejscu przy tylnym murze.
  // Świątynia (kolumny) i wieża (pierścień kręconych schodów) mają własne przeszkody — tam meble stawia się ręcznie.
  for (const set of FURNITURE_SETS.filter((s) => !s.outdoor)) {
    for (const type of ['house', 'palace', 'library'] as const) {
      for (const scale of [SHELLS[type].minScale, SHELLS[type].minScale * 1.4]) {
        it(`„${set.name}" w ${type} (skala ${scale.toFixed(2)}): jest gdzie go postawić`, () => {
          const b = building(type, scale, 0.4, 1);
          const room = roomOfBuilding(b);
          if (set.width + 0.6 > 2 * room.box.hx || set.depth + 0.6 > 2 * room.box.hz) return; // zestaw większy niż wnętrze — użytkownik dostaje ostrzeżenie
          const span = room.box.hx - set.width / 2 - 0.15;
          let best: string[] | null = null;
          for (let off = -span; off <= span + 1e-6; off += 0.5) {
            const problems = layoutProblems(room, placeSetIn(set, room, buildingFloorY(b, 0), off), 1, buildingFloorY(b, 0));
            if (problems.length === 0) return;
            if (!best || problems.length < best.length) best = problems;
          }
          expect(best ?? ['brak miejsca przy ścianie'], `nigdzie przy ścianie:\n${(best ?? []).join('\n')}`).toEqual([]);
        });
      }
    }
  }
});

describe('siatka przejść', () => {
  it('ścianka bez drzwi odcina część pokoju, z drzwiami nie', () => {
    const b = building('house');
    const room = roomOfBuilding(b);
    const wall: PalaceObject = { id: 'w', type: 'wall', name: 'Ściana', position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [room.box.hz, 1, 1] };
    const solid = new WalkGrid(room, obstacleOf(wall, [wall], room.floorHeight));
    const seen = solid.reachable(room.entry[0], room.entry[1]);
    // wejście domku jest po lewej (drzwi przy x < 0), więc odcięta ma być prawa połowa
    const far: [number, number] = [room.box.cx + room.box.hx - 0.6, room.box.cz];
    expect(solid.near(seen, far[0], far[1], 0.3), 'ścianka bez drzwi powinna odcinać drugą połowę').toBe(false);

    const door: PalaceObject = { id: 'd', type: 'door', name: 'Drzwi', position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1], anchorId: 'w' };
    const open = new WalkGrid(room, obstacleOf(wall, [wall, door], room.floorHeight));
    const seen2 = open.reachable(room.entry[0], room.entry[1]);
    expect(open.near(seen2, far[0], far[1], 0.3), 'przez drzwi powinno dać się przejść').toBe(true);
  });

  it('przejście węższe niż kapsuła gracza jest zablokowane', () => {
    const b = building('house');
    const room = roomOfBuilding(b);
    const gap = PLAYER_R * 2 - 0.1; // 0,54 m — mniej niż średnica kapsuły z zapasem
    const hx = room.box.hx;
    const half = (hx - gap / 2) / 2;
    const blockers: PalaceObject[] = [
      { id: 'a', type: 'wall', name: 'a', position: [-gap / 2 - half, 0, 0], rotation: [0, 0, 0], scale: [(2 * half) / 2, 1, 1] },
      { id: 'b', type: 'wall', name: 'b', position: [gap / 2 + half, 0, 0], rotation: [0, 0, 0], scale: [(2 * half) / 2, 1, 1] },
    ];
    const grid = new WalkGrid(room, blockers.flatMap((o) => obstacleOf(o, blockers, room.floorHeight)));
    const seen = grid.reachable(room.entry[0], room.entry[1]);
    const behind: [number, number] = [room.box.cx, room.box.cz - room.box.hz + 0.6];
    expect(grid.near(seen, behind[0], behind[1], 0.3), 'szczelina 0,54 m nie powinna przepuścić gracza').toBe(false);
  });
});

describe('reguły rozmieszczenia', () => {
  const win = [{ x: 0, z: -3, half: 0.5 }];

  it('kandelabra ani pochodni nie stawiamy na stole, biurku i blacie', () => {
    for (const on of ['table', 'desk', 'counter', 'sideboard', 'shelf']) {
      expect(placementBlock('candle', { anchorType: on, x: 0, z: 0 }), `świeca na ${on}`).not.toBeNull();
      expect(placementBlock('torch', { anchorType: on, x: 0, z: 0 }), `pochodnia na ${on}`).not.toBeNull();
    }
    // wazon i naczynia na blacie są w porządku — reguła dotyczy ognia i papieru
    expect(placementBlock('vase', { anchorType: 'table', x: 0, z: 0 })).toBeNull();
    expect(placementBlock('dishes', { anchorType: 'counter', x: 0, z: 0 })).toBeNull();
    expect(placementBlock('candle', { anchorType: undefined, x: 0, z: 0 }), 'świeca na podłodze').toBeNull();
  });

  it('książek nie kładziemy na biurku, ale na stole i regale wolno', () => {
    expect(placementBlock('books', { anchorType: 'desk', x: 0, z: 0 })).not.toBeNull();
    expect(placementBlock('books', { anchorType: 'table', x: 0, z: 0 })).toBeNull();
    expect(placementBlock('books', { anchorType: 'shelf', x: 0, z: 0 })).toBeNull();
  });

  it('obrazu ani lustra nie da się powiesić na oknie, obok wolno', () => {
    for (const type of ['painting', 'mirror']) {
      expect(placementBlock(type, { windows: win, x: 0, z: -3 }), `${type} na oknie`).not.toBeNull();
      expect(placementBlock(type, { windows: win, x: 2, z: -3 }), `${type} obok okna`).toBeNull();
    }
    // zasłony przy oknie są na miejscu, zegar stojący można postawić pod parapetem, a kredens nic nie zasłania
    for (const type of ['curtains', 'clock', 'sideboard']) {
      expect(placementBlock(type, { windows: win, x: 0, z: -3 }), `${type} przy oknie`).toBeNull();
    }
  });

  it('okno postawione z biblioteki też blokuje wieszanie', () => {
    const b = building('house', SHELLS.house.minScale, 0, 1);
    const room = roomOfBuilding(b);
    const wall = room.box.cz - room.box.hz;
    const okno: PalaceObject = { id: 'w1', type: 'window', name: 'Okno', position: [1.2, 0, wall], rotation: [0, 0, 0], scale: [1, 1, 1], anchorId: b.id };
    const zOknem = roomOfBuilding(b, [b, okno]);
    expect(zOknem.windows!.length, 'okno z biblioteki nie trafiło na listę').toBeGreaterThan(room.windows!.length);
    expect(placementBlock('painting', { windows: zOknem.windows, x: 1.2, z: wall })).not.toBeNull();
  });

  it('layoutProblems zgłasza złamaną regułę razem z resztą uwag', () => {
    const room: RoomShape = { box: { cx: 0, cz: 0, hx: 3, hz: 3, yaw: 0 }, floorHeight: 3.2, entry: [0, 2.3] };
    const stol: PalaceObject = { id: 't', type: 'table', name: 'Stół', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const swieca: PalaceObject = { id: 'c', type: 'candle', name: 'Kandelabr', position: [0, 0.81, 0], rotation: [0, 0, 0], scale: [1, 1, 1], anchorId: 't' };
    const problems = layoutProblems(room, [stol, swieca], 1);
    expect(problems.some((x) => x.includes('Kandelabr')), problems.join('\n')).toBe(true);
  });
});
