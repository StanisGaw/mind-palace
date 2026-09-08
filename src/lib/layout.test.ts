import { describe, expect, it } from 'vitest';
import { ROOM_PRESETS, instantiatePreset, instantiatePresetIn } from './presets';
import { SHELLS, buildingFloorY, floorOf, maxFloorsOf } from './rooms';
import { ROOMS } from '../catalog';
import { PLAYER_R, WalkGrid, boxCorners, boxesOverlap, findStairsIn, findStairsSpot, insideRoom, layoutProblems, obstacleOf, pointInBox, roomOfBuilding, roomOfSpec, stairBoxes } from './layout';
import type { PalaceObject, Vec3 } from '../types';

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
    const preset = ROOM_PRESETS.find((p) => p.id === 'palace-hall')!;
    const objects = [b, ...instantiatePresetIn(preset, b)];
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

describe('wbudowane układy pokoi', () => {
  for (const preset of ROOM_PRESETS) {
    const types = preset.buildingTypes ?? (TYPES as readonly string[]);
    for (const type of types) {
      for (const scale of [SHELLS[type].minScale, SHELLS[type].minScale * 1.4]) {
        it(`„${preset.name}" w ${type} (skala ${scale.toFixed(2)}): da się z niego korzystać`, () => {
          const floors = Math.min(maxFloorsOf(type), Math.max(1, preset.floors));
          const b = building(type, scale, 0, floors);
          const objects = [b, ...instantiatePresetIn(preset, b)];
          // układ na kilka pięter dostaje schody tak samo jak w aplikacji
          if (floors > 1 && type !== 'tower' && !objects.some((o) => o.type === 'stairs')) {
            const spot = findStairsSpot(b, objects);
            expect(spot, 'układ wielopiętrowy bez miejsca na schody').not.toBeNull();
            objects.push({ id: 's1', type: 'stairs', name: 'Schody', position: spot!.position, rotation: [0, spot!.rotationY, 0], scale: [1, 1, 1], anchorId: b.id });
          }
          const room = roomOfBuilding(b);
          const problems = layoutProblems(room, objects.filter((o) => o.id !== b.id), floors, buildingFloorY(b, 0));
          expect(problems, problems.join('\n')).toEqual([]);
        });
      }
    }
  }

  it('układ w pokoju ładowanym osobno też jest przejezdny', () => {
    for (const preset of ROOM_PRESETS) {
      for (const type of preset.buildingTypes ?? ['house']) {
        // pokój ładowany osobno ma wymiary z katalogu (mniejszy niż wnętrze w miejscu) — ostrzejszy przypadek
        const spec = { ...ROOMS[type] };
        const objects = instantiatePreset(preset, spec);
        const room = roomOfSpec(spec, type);
        const floors = Math.min(maxFloorsOf(type), preset.floors);
        // pokój ładowany dostaje schody tak samo jak w aplikacji (`addStairsToRoom`)
        if (floors > 1 && type !== 'tower' && !objects.some((o) => o.type === 'stairs')) {
          const spot = findStairsIn(room, objects.filter((o) => floorOf(o.position[1], spec.height) === 0), objects, 0);
          expect(spot, `${preset.name} / ${type}: brak miejsca na schody`).not.toBeNull();
          objects.push({ id: 's1', type: 'stairs', name: 'Schody', position: spot!.position, rotation: [0, spot!.rotationY, 0], scale: [1, 1, 1] });
        }
        const problems = layoutProblems(room, objects, floors);
        expect(problems, `${preset.name} / ${type}:\n${problems.join('\n')}`).toEqual([]);
      }
    }
  });
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
