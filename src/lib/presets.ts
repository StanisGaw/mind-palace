import { yawRotation } from './transform';
import { uid } from './ids';
import { ROOMS, catalogItem } from '../catalog';
import { SHELLS, WALL_SEGMENT, attachLegacyDoors, buildingFloorY, floorOf, worldXZ } from './rooms';
import type { Palace, PalaceObject, PresetObject, RoomPreset, RoomSpec, Vec3 } from '../types';

/** Dwie lampy sufitowe na każdą kondygnację — bez nich zastosowany układ byłby ciemny. Zawsze na końcu listy: `anchor` to indeks. */
function lamps(floors: number): PresetObject[] {
  const out: PresetObject[] = [];
  for (let k = 0; k < floors; k++) for (const u of [-0.28, 0.28]) out.push({ type: 'ceiling_lamp', u, v: 0, floor: k, rotationY: 0 });
  return out;
}

/**
 * Układy pokoi wbudowane w aplikację. Współrzędne są względne (u, v ∈ -0.5..0.5, ściany przez `span`),
 * więc ten sam preset pasuje do budynku w dowolnej skali.
 */
export const ROOM_PRESETS: RoomPreset[] = [
  {
    id: 'house-two-rooms',
    name: 'Dwa pokoje z korytarzem',
    description: 'Ścianka z drzwiami dzieli domek na jadalnię i sypialnię.',
    buildingTypes: ['house'],
    floors: 1,
    objects: [
      { type: 'wall', u: 0.08, v: 0, floor: 0, rotationY: Math.PI / 2, span: { axis: 'z', frac: 1 } },
      { type: 'door', u: 0.08, v: 0.22, floor: 0, rotationY: Math.PI / 2, anchor: 0 },
      // jadalnia od strony wejścia: stół z krzesłami w stałych odstępach
      { type: 'table', u: -0.22, v: -0.05, floor: 0, rotationY: 0 },
      { type: 'chair', u: -0.22, v: -0.05, dz: -0.78, floor: 0, rotationY: 0 },
      { type: 'chair', u: -0.22, v: -0.05, dz: 0.78, floor: 0, rotationY: Math.PI },
      { type: 'chair', u: -0.22, v: -0.05, dx: -1.05, floor: 0, rotationY: Math.PI / 2 },
      { type: 'chair', u: -0.22, v: -0.05, dx: 1.05, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'rug', u: -0.22, v: -0.05, floor: 0, rotationY: 0 },
      { type: 'sideboard', u: -0.22, v: -0.5, dz: 0.32, floor: 0, rotationY: 0 },
      { type: 'painting', u: -0.22, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      // sypialnia za ścianką
      { type: 'bed', u: 0.32, v: -0.5, dz: 1.12, floor: 0, rotationY: 0 },
      { type: 'shelf', u: 0.5, dx: -0.32, v: 0.22, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'curtains', u: 0.5, dx: -0.08, v: -0.1, floor: 0, rotationY: -Math.PI / 2 },
      ...lamps(1),
    ],
  },
  {
    id: 'house-attic',
    name: 'Poddasze',
    description: 'Sypialnia na dole, skład na piętrze — schody dostawiane automatycznie.',
    buildingTypes: ['house'],
    floors: 2,
    objects: [
      { type: 'bed', u: -0.2, v: -0.5, dz: 1.12, floor: 0, rotationY: 0 },
      { type: 'painting', u: -0.2, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'sideboard', u: -0.5, dx: 0.32, v: 0.15, floor: 0, rotationY: Math.PI / 2 },
      { type: 'chest', u: -0.25, v: -0.5, dz: 0.35, floor: 1, rotationY: 0 },
      { type: 'shelf', u: -0.5, dx: 0.32, v: 0.1, floor: 1, rotationY: Math.PI / 2 },
      { type: 'lantern', u: 0.2, v: 0.2, floor: 1, rotationY: 0 },
      ...lamps(2),
    ],
  },
  {
    id: 'palace-hall',
    name: 'Sala i dwie komnaty',
    description: 'Centralna sala z komnatami po obu stronach, drzwi w obu ściankach.',
    buildingTypes: ['palace'],
    floors: 1,
    objects: [
      { type: 'wall', u: -0.22, v: 0, floor: 0, rotationY: Math.PI / 2, span: { axis: 'z', frac: 1 } },
      { type: 'door', u: -0.22, v: 0.24, floor: 0, rotationY: Math.PI / 2, anchor: 0 },
      { type: 'wall', u: 0.22, v: 0, floor: 0, rotationY: Math.PI / 2, span: { axis: 'z', frac: 1 } },
      { type: 'door', u: 0.22, v: 0.24, floor: 0, rotationY: Math.PI / 2, anchor: 2 },
      // sala środkowa
      { type: 'rug', u: 0, v: -0.05, floor: 0, rotationY: 0, scale: [1.2, 1, 1.6] },
      { type: 'table', u: 0, v: -0.12, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: -0.12, dz: 0.78, floor: 0, rotationY: Math.PI },
      { type: 'chair', u: 0, v: -0.12, dz: -0.78, floor: 0, rotationY: 0 },
      { type: 'painting', u: -0.15, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      // komnata lewa i prawa
      { type: 'bench', u: -0.5, dx: 0.3, v: -0.15, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: -0.5, dx: 0.08, v: 0.15, floor: 0, rotationY: Math.PI / 2 },
      { type: 'bust', u: 0.5, dx: -0.35, v: -0.15, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: 0.5, dx: -0.08, v: 0.15, floor: 0, rotationY: -Math.PI / 2 },
      ...lamps(1),
    ],
  },
  {
    id: 'palace-amfilada',
    name: 'Amfilada',
    description: 'Trzy komnaty w rzędzie, drzwi jedne za drugimi.',
    buildingTypes: ['palace'],
    floors: 1,
    objects: [
      { type: 'wall', u: 0, v: -0.18, floor: 0, rotationY: 0, span: { axis: 'x', frac: 1 } },
      { type: 'door', u: 0, v: -0.18, floor: 0, rotationY: 0, anchor: 0 },
      { type: 'wall', u: 0, v: 0.18, floor: 0, rotationY: 0, span: { axis: 'x', frac: 1 } },
      { type: 'door', u: 0, v: 0.18, floor: 0, rotationY: 0, anchor: 2 },
      { type: 'statue', u: 0, v: -0.5, dz: 0.6, floor: 0, rotationY: 0 },
      { type: 'painting', u: -0.2, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0.2, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'bench', u: -0.5, dx: 0.3, v: 0, floor: 0, rotationY: Math.PI / 2 },
      { type: 'bench', u: 0.5, dx: -0.3, v: 0, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'candle', u: -0.2, v: 0.32, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0.2, v: 0.32, floor: 0, rotationY: 0 },
      ...lamps(1),
    ],
  },
  {
    id: 'tower-floors',
    name: 'Trzy kondygnacje',
    description: 'Kręcone schody wieży prowadzą przez wszystkie piętra.',
    buildingTypes: ['tower'],
    floors: 3,
    objects: [
      { type: 'chest', u: -0.12, v: -0.12, floor: 0, rotationY: 0.4 },
      { type: 'table', u: 0, v: 0, floor: 1, rotationY: 0 },
      { type: 'chair', u: 0, v: 0, dz: 0.78, floor: 1, rotationY: Math.PI },
      { type: 'bed', u: 0, v: 0, floor: 2, rotationY: 0 },
      { type: 'candle', u: 0.14, v: 0.14, floor: 0, rotationY: 0 },
      ...lamps(3),
    ],
  },
  {
    id: 'library-reading',
    name: 'Czytelnia',
    description: 'Regały pod ścianami, stół z krzesłami pośrodku.',
    buildingTypes: ['library'],
    floors: 1,
    objects: [
      { type: 'shelf', u: -0.5, dx: 0.32, v: -0.2, floor: 0, rotationY: Math.PI / 2 },
      { type: 'shelf', u: -0.5, dx: 0.32, v: 0.15, floor: 0, rotationY: Math.PI / 2 },
      { type: 'shelf', u: 0.5, dx: -0.32, v: -0.2, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'shelf', u: 0.5, dx: -0.32, v: 0.15, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'shelf', u: -0.22, v: -0.5, dz: 0.32, floor: 0, rotationY: 0 },
      { type: 'shelf', u: 0.22, v: -0.5, dz: 0.32, floor: 0, rotationY: 0 },
      { type: 'table', u: 0, v: 0, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: 0, dz: -0.78, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: 0, dz: 0.78, floor: 0, rotationY: Math.PI },
      { type: 'chair', u: 0, v: 0, dx: -1.05, floor: 0, rotationY: Math.PI / 2 },
      { type: 'chair', u: 0, v: 0, dx: 1.05, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'globe', u: 0, v: 0, dx: 0.5, dy: 0.81, floor: 0, rotationY: 0, anchor: 6 },
      { type: 'rug', u: 0, v: 0, floor: 0, rotationY: 0, scale: [1.4, 1, 1.4] },
      ...lamps(1),
    ],
  },
  {
    id: 'library-sections',
    name: 'Dwa działy',
    description: 'Ścianka z drzwiami rozdziela dwa księgozbiory.',
    buildingTypes: ['library'],
    floors: 1,
    objects: [
      // ścianka w poprzek, nie na osi wejścia (drzwi biblioteki są pośrodku frontowej ściany)
      { type: 'wall', u: 0, v: -0.02, floor: 0, rotationY: 0, span: { axis: 'x', frac: 1 } },
      { type: 'door', u: -0.28, v: -0.02, floor: 0, rotationY: 0, anchor: 0 },
      { type: 'shelf', u: -0.5, dx: 0.32, v: -0.2, floor: 0, rotationY: Math.PI / 2 },
      { type: 'shelf', u: -0.5, dx: 0.32, v: 0.18, floor: 0, rotationY: Math.PI / 2 },
      { type: 'shelf', u: -0.25, v: -0.5, dz: 0.32, floor: 0, rotationY: 0 },
      { type: 'shelf', u: 0.5, dx: -0.32, v: -0.2, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'shelf', u: 0.25, v: -0.5, dz: 0.32, floor: 0, rotationY: 0 },
      { type: 'desk', u: 0.25, v: 0.28, floor: 0, rotationY: Math.PI },
      { type: 'chair', u: 0.25, v: 0.28, dz: -0.75, floor: 0, rotationY: 0 },
      ...lamps(1),
    ],
  },
  {
    id: 'temple-hall',
    name: 'Sala główna',
    description: 'Świece przy ołtarzu, dywan na osi i ławki między kolumnami.',
    buildingTypes: ['temple'],
    floors: 1,
    objects: [
      { type: 'candle', u: -0.15, v: -0.3, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0.15, v: -0.3, floor: 0, rotationY: 0 },
      { type: 'rug', u: 0, v: 0.05, floor: 0, rotationY: 0, scale: [1, 1, 1.6] },
      // ławki między kolumnami: kolumny stoją 0,3 jednostki od krawędzi, więc trzymamy się bliżej środka
      { type: 'bench', u: -0.344, v: 0.1, floor: 0, rotationY: Math.PI / 2 },
      { type: 'bench', u: 0.344, v: 0.1, floor: 0, rotationY: -Math.PI / 2 },
      ...lamps(1),
    ],
  },
  {
    id: 'temple-antechamber',
    name: 'Ołtarz i przedsionek',
    description: 'Ścianka z drzwiami oddziela wejście od ołtarza.',
    buildingTypes: ['temple'],
    floors: 1,
    objects: [
      { type: 'wall', u: 0, v: 0.22, floor: 0, rotationY: 0, span: { axis: 'x', frac: 1 } },
      { type: 'door', u: -0.2, v: 0.22, floor: 0, rotationY: 0, anchor: 0 },
      { type: 'candle', u: -0.15, v: -0.3, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0.15, v: -0.3, floor: 0, rotationY: 0 },
      { type: 'bench', u: -0.344, v: 0.38, floor: 0, rotationY: Math.PI / 2 },
      ...lamps(1),
    ],
  },
  {
    id: 'house-salon',
    name: 'Salon z kominkiem',
    description: 'Sofa i fotele przy ogniu, obraz nad kominkiem, zasłony w oknie.',
    buildingTypes: ['house'],
    floors: 1,
    objects: [
      { type: 'fireplace', u: 0, v: -0.5, dz: 0.42, floor: 0, rotationY: 0 },
      // obraz obok komina, nie za nim
      { type: 'painting', u: -0.28, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'clock', u: 0, v: -0.5, dz: 0.16, dx: 1.6, floor: 0, rotationY: 0 },
      { type: 'sofa', u: 0, v: -0.5, dz: 2.9, floor: 0, rotationY: Math.PI },
      { type: 'armchair', u: 0, v: -0.5, dz: 1.9, dx: -1.9, floor: 0, rotationY: Math.PI / 2 },
      { type: 'armchair', u: 0, v: -0.5, dz: 1.9, dx: 1.9, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'rug', u: 0, v: -0.5, dz: 2.0, floor: 0, rotationY: 0, scale: [1.6, 1, 1.2] },
      { type: 'table', u: 0.28, v: 0.34, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0.28, v: 0.34, dx: -1.05, floor: 0, rotationY: Math.PI / 2 },
      { type: 'vase', u: 0.28, v: 0.34, dy: 0.81, floor: 0, rotationY: 0, anchor: 7 },
      { type: 'curtains', u: -0.5, dx: 0.08, v: 0.1, floor: 0, rotationY: Math.PI / 2 },
      ...lamps(1),
    ],
  },
  {
    id: 'house-bedroom',
    name: 'Sypialnia',
    description: 'Łóżko pod ścianą, kredens, lustro i obraz nad wezgłowiem.',
    buildingTypes: ['house'],
    floors: 1,
    objects: [
      { type: 'bed', u: -0.12, v: -0.5, dz: 1.12, floor: 0, rotationY: 0 },
      { type: 'painting', u: -0.12, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'sideboard', u: 0.5, dx: -0.32, v: -0.1, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'vase', u: 0.5, dx: -0.32, v: -0.1, dy: 0.94, floor: 0, rotationY: 0, anchor: 2 },
      { type: 'mirror', u: -0.5, dx: 0.08, v: 0.05, floor: 0, rotationY: Math.PI / 2 },
      { type: 'curtains', u: 0.5, dx: -0.08, v: 0.3, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'rug', u: -0.12, v: 0.2, floor: 0, rotationY: 0 },
      { type: 'chest', u: -0.12, v: -0.5, dz: 3.0, floor: 0, rotationY: 0 },
      ...lamps(1),
    ],
  },
  {
    id: 'house-study',
    name: 'Gabinet',
    description: 'Biurko z lampką, regały, zegar i popiersie — miejsce do pracy nad myślami.',
    buildingTypes: ['house'],
    floors: 1,
    objects: [
      { type: 'desk', u: 0, v: -0.5, dz: 1.1, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: -0.5, dz: 1.85, floor: 0, rotationY: Math.PI },
      { type: 'shelf', u: -0.5, dx: 0.32, v: -0.15, floor: 0, rotationY: Math.PI / 2 },
      { type: 'shelf', u: -0.5, dx: 0.32, v: 0.2, floor: 0, rotationY: Math.PI / 2 },
      { type: 'clock', u: -0.2, v: -0.5, dz: 0.16, floor: 0, rotationY: 0 },
      { type: 'bust', u: 0.5, dx: -0.35, v: -0.25, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: 0.5, dx: -0.08, v: 0.1, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'rug', u: 0, v: 0.1, floor: 0, rotationY: 0 },
      { type: 'books', u: 0, v: -0.5, dz: 1.1, dx: 0.45, dy: 0.78, floor: 0, rotationY: 0.3, anchor: 0 },
      ...lamps(1),
    ],
  },
  {
    id: 'house-dining',
    name: 'Jadalnia',
    description: 'Stół z sześcioma krzesłami, kredens pod ścianą, kandelabr na stole.',
    buildingTypes: ['house'],
    floors: 1,
    objects: [
      { type: 'table', u: 0, v: 0, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0, v: 0, dy: 0.81, floor: 0, rotationY: 0, anchor: 0 },
      { type: 'chair', u: 0, v: 0, dx: -0.55, dz: -0.78, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: 0, dx: 0.55, dz: -0.78, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: 0, dx: -0.55, dz: 0.78, floor: 0, rotationY: Math.PI },
      { type: 'chair', u: 0, v: 0, dx: 0.55, dz: 0.78, floor: 0, rotationY: Math.PI },
      { type: 'chair', u: 0, v: 0, dx: -1.15, floor: 0, rotationY: Math.PI / 2 },
      { type: 'chair', u: 0, v: 0, dx: 1.15, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'rug', u: 0, v: 0, floor: 0, rotationY: 0, scale: [1.6, 1, 1.4] },
      { type: 'sideboard', u: 0, v: -0.5, dz: 0.32, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'curtains', u: 0.5, dx: -0.08, v: 0, floor: 0, rotationY: -Math.PI / 2 },
      ...lamps(1),
    ],
  },
  {
    id: 'palace-throne',
    name: 'Sala tronowa',
    description: 'Dywan prowadzi do tronu, wzdłuż stoją kandelabry, na ścianie obrazy.',
    buildingTypes: ['palace'],
    floors: 1,
    objects: [
      { type: 'rug', u: 0, v: 0, floor: 0, rotationY: 0, scale: [1.4, 1, 2.6] },
      { type: 'armchair', u: 0, v: -0.5, dz: 0.8, floor: 0, rotationY: 0 },
      { type: 'bust', u: 0, v: -0.5, dz: 0.6, dx: -1.4, floor: 0, rotationY: 0 },
      { type: 'bust', u: 0, v: -0.5, dz: 0.6, dx: 1.4, floor: 0, rotationY: 0 },
      { type: 'candle', u: -0.22, v: -0.2, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0.22, v: -0.2, floor: 0, rotationY: 0 },
      { type: 'candle', u: -0.22, v: 0.05, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0.22, v: 0.05, floor: 0, rotationY: 0 },
      { type: 'candle', u: -0.22, v: 0.3, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0.22, v: 0.3, floor: 0, rotationY: 0 },
      { type: 'painting', u: -0.2, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0.2, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'curtains', u: -0.5, dx: 0.08, v: -0.15, floor: 0, rotationY: Math.PI / 2 },
      { type: 'curtains', u: 0.5, dx: -0.08, v: -0.15, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'bench', u: -0.5, dx: 0.3, v: 0.28, floor: 0, rotationY: Math.PI / 2 },
      { type: 'bench', u: 0.5, dx: -0.3, v: 0.28, floor: 0, rotationY: -Math.PI / 2 },
      ...lamps(1),
    ],
  },
  {
    id: 'palace-gallery',
    name: 'Galeria',
    description: 'Obrazy wzdłuż ścian, popiersia na osi i ławki pośrodku.',
    buildingTypes: ['palace'],
    floors: 1,
    objects: [
      { type: 'painting', u: -0.5, dx: 0.08, v: -0.3, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: -0.5, dx: 0.08, v: -0.1, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: -0.5, dx: 0.08, v: 0.1, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: -0.5, dx: 0.08, v: 0.3, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: 0.5, dx: -0.08, v: -0.3, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: 0.5, dx: -0.08, v: -0.1, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: 0.5, dx: -0.08, v: 0.1, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: 0.5, dx: -0.08, v: 0.3, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: -0.2, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0.2, v: -0.5, dz: 0.08, floor: 0, rotationY: 0 },
      { type: 'bust', u: 0, v: -0.5, dz: 0.6, floor: 0, rotationY: 0 },
      { type: 'bust', u: -0.3, v: 0.05, floor: 0, rotationY: 0 },
      { type: 'bust', u: 0.3, v: 0.05, floor: 0, rotationY: 0 },
      { type: 'bench', u: 0, v: -0.12, floor: 0, rotationY: 0 },
      { type: 'bench', u: 0, v: 0.12, floor: 0, rotationY: Math.PI },
      { type: 'rug', u: 0, v: 0, floor: 0, rotationY: 0, scale: [1.2, 1, 2] },
      ...lamps(1),
    ],
  },
  {
    id: 'tower-study',
    name: 'Pracownia',
    description: 'Biurko i regał na dole, sypialnia na piętrze — kręcone schody łączą kondygnacje.',
    buildingTypes: ['tower'],
    floors: 2,
    objects: [
      { type: 'desk', u: 0, v: -0.15, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: -0.15, dz: 0.75, floor: 0, rotationY: Math.PI },
      { type: 'shelf', u: -0.2, v: 0.12, floor: 0, rotationY: Math.PI / 2 },
      { type: 'candle', u: 0.18, v: 0.16, floor: 0, rotationY: 0 },
      { type: 'bed', u: 0, v: -0.12, floor: 1, rotationY: 0 },
      { type: 'sideboard', u: 0, v: 0.25, floor: 1, rotationY: Math.PI },
      { type: 'vase', u: 0, v: 0.25, dy: 0.94, floor: 1, rotationY: 0, anchor: 5 },
      ...lamps(2),
    ],
  },
  {
    id: 'empty-room',
    name: 'Pusty pokój',
    description: 'Czyste wnętrze bez podziałów — dobry punkt startowy.',
    floors: 1,
    objects: [...lamps(1)],
  },
];

/** Zamienia układ na liście `PalaceObject` we współrzędnych bieżącego pokoju. */
export function instantiatePreset(preset: RoomPreset, spec: RoomSpec): PalaceObject[] {
  const ids = preset.objects.map(() => uid());
  const groupIds = new Map<number, string>();
  const objects = preset.objects.map((po, i) => {
    const item = catalogItem(po.type);
    let scale: Vec3 = po.scale ?? [1, 1, 1];
    if (po.span) {
      const dim = po.span.axis === 'x' ? spec.width : spec.depth;
      const factor = (po.span.frac * dim) / WALL_SEGMENT;
      scale = [factor, scale[1], scale[2]];
    }
    const anchorId = po.anchor !== undefined && po.anchor !== i ? ids[po.anchor] : undefined;
    let groupId: string | undefined;
    if (po.group !== undefined) {
      groupId = groupIds.get(po.group) ?? uid('g');
      groupIds.set(po.group, groupId);
    }
    return {
      id: ids[i],
      type: po.type,
      name: po.name ?? item.name,
      position: [po.u * spec.width + (po.dx ?? 0), po.floor * spec.height + (po.dy ?? 0), po.v * spec.depth + (po.dz ?? 0)] as Vec3,
      rotation: yawRotation(po.rotationY),
      scale,
      anchorId,
      groupId,
    };
  });
  // własne presety sprzed kotwiczenia drzwi w ściance: drzwi-segment dostaje ściankę
  return attachLegacyDoors(objects, uid);
}

/** Wymiary wnętrza budynku z wnętrzem w miejscu jako `RoomSpec` (szerokość i głębokość w metrach świata). */
export function specOfBuilding(b: PalaceObject): RoomSpec {
  const shell = SHELLS[b.type] ?? SHELLS.house;
  return { ...(ROOMS[b.type] ?? ROOMS.house), width: shell.inner.w * b.scale[0], depth: shell.inner.d * b.scale[2], height: buildingFloorY(b, 1) - buildingFloorY(b, 0) };
}

/**
 * Układ w budynku z wnętrzem w miejscu: liczony w wymiarach jego wnętrza, przeniesiony do świata (obrót i skala
 * budynku) i zakotwiczony w budynku; obiekty zakotwiczone w innych obiektach układu zachowują swoją kotwicę.
 */
export function instantiatePresetIn(preset: RoomPreset, b: PalaceObject): PalaceObject[] {
  const shell = SHELLS[b.type] ?? SHELLS.house;
  const spec = specOfBuilding(b);
  return instantiatePreset(preset, spec).map((o) => {
    const [wx, wz] = worldXZ(b, shell.cx + o.position[0] / b.scale[0], shell.cz + o.position[2] / b.scale[2]);
    return { ...o, position: [wx, buildingFloorY(b, 0) + o.position[1], wz] as Vec3, rotation: yawRotation(o.rotation[1] + b.rotation[1]), anchorId: o.anchorId ?? b.id };
  });
}

/** Odwrotność `instantiatePreset`: bieżący układ pokoju jako preset do zapisania. Obiekty z notatkami pomijamy. */
export function capturePreset(name: string, palace: Palace, spec: RoomSpec): RoomPreset {
  const kept = palace.objects.filter((o) => !o.note);
  const indexOf = new Map(kept.map((o, i) => [o.id, i]));
  const groupNo = new Map<string, number>();
  const objects: PresetObject[] = kept.map((o) => {
      const floor = floorOf(o.position[1], spec.height);
      const po: PresetObject = {
        type: o.type,
        u: o.position[0] / spec.width,
        v: o.position[2] / spec.depth,
        floor,
        dy: o.position[1] - floor * spec.height,
        rotationY: o.rotation[1],
      };
      const anchor = o.anchorId ? indexOf.get(o.anchorId) : undefined;
      if (anchor !== undefined) po.anchor = anchor;
      if (o.groupId) {
        if (!groupNo.has(o.groupId)) groupNo.set(o.groupId, groupNo.size);
        po.group = groupNo.get(o.groupId);
      }
      if (o.type === 'wall') {
        // długość ściany zapisujemy jako ułamek wymiaru pokoju, żeby preset pasował do innej skali
        const alongX = Math.cos(o.rotation[1]) ** 2 > 0.5;
        const dim = alongX ? spec.width : spec.depth;
        po.span = { axis: alongX ? 'x' : 'z', frac: (o.scale[0] * WALL_SEGMENT) / dim };
      } else if (o.scale[0] !== 1 || o.scale[1] !== 1 || o.scale[2] !== 1) {
        po.scale = o.scale;
      }
      return po;
    });
  return { id: uid('rp'), name, description: '', floors: palace.interior?.floors ?? 1, objects, custom: true };
}
