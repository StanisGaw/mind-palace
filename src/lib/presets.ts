import { catalogItem } from '../catalog';
import { yawRotation } from './transform';
import { uid } from './ids';
import { WALL_SEGMENT, attachLegacyDoors, floorOf } from './rooms';
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
    description: 'Ścianka z drzwiami dzieli domek na dwa pomieszczenia.',
    buildingTypes: ['house'],
    floors: 1,
    objects: [
      { type: 'wall', u: 0, v: 0, floor: 0, rotationY: Math.PI / 2, span: { axis: 'z', frac: 1 } },
      { type: 'door', u: 0, v: 0, floor: 0, rotationY: Math.PI / 2, anchor: 0 },
      { type: 'table', u: -0.22, v: -0.15, floor: 0, rotationY: 0 },
      { type: 'chair', u: -0.22, v: 0.05, floor: 0, rotationY: Math.PI },
      { type: 'shelf', u: 0.35, v: -0.35, floor: 0, rotationY: Math.PI / 2 },
      { type: 'rug', u: 0.15, v: 0.15, floor: 0, rotationY: 0 },
      ...lamps(1),
    ],
  },
  {
    id: 'house-attic',
    name: 'Poddasze',
    description: 'Schody prowadzą na dodatkowe piętro pod dachem.',
    buildingTypes: ['house'],
    floors: 2,
    objects: [
      { type: 'stairs', u: 0.2, v: -0.25, floor: 0, rotationY: 0 },
      { type: 'chest', u: -0.25, v: 0.15, floor: 1, rotationY: 0 },
      { type: 'lantern', u: 0.3, v: 0.3, floor: 0, rotationY: 0 },
      ...lamps(2),
    ],
  },
  {
    id: 'palace-hall',
    name: 'Sala i dwie komnaty',
    description: 'Centralna sala z komnatami po obu stronach.',
    buildingTypes: ['palace'],
    floors: 1,
    objects: [
      { type: 'wall', u: -0.15, v: 0, floor: 0, rotationY: Math.PI / 2, span: { axis: 'z', frac: 1 } },
      { type: 'door', u: -0.15, v: 0.3, floor: 0, rotationY: Math.PI / 2, anchor: 0 },
      { type: 'wall', u: 0.15, v: 0, floor: 0, rotationY: Math.PI / 2, span: { axis: 'z', frac: 1 } },
      { type: 'door', u: 0.15, v: 0.3, floor: 0, rotationY: Math.PI / 2, anchor: 2 },
      { type: 'table', u: 0, v: -0.1, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: 0.1, floor: 0, rotationY: Math.PI },
      { type: 'bench', u: -0.35, v: -0.1, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: 0.35, v: -0.3, floor: 0, rotationY: -Math.PI / 2 },
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
      { type: 'wall', u: 0, v: -0.15, floor: 0, rotationY: 0, span: { axis: 'x', frac: 0.8 } },
      { type: 'door', u: 0, v: -0.15, floor: 0, rotationY: 0, anchor: 0 },
      { type: 'wall', u: 0, v: 0.15, floor: 0, rotationY: 0, span: { axis: 'x', frac: 0.8 } },
      { type: 'door', u: 0, v: 0.15, floor: 0, rotationY: 0, anchor: 2 },
      { type: 'statue', u: 0, v: -0.35, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0, v: 0, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0, v: 0.38, floor: 0, rotationY: Math.PI },
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
      { type: 'chair', u: -0.2, v: -0.2, floor: 2, rotationY: 0 },
      { type: 'candle', u: 0.2, v: 0.2, floor: 0, rotationY: 0 },
      ...lamps(3),
    ],
  },
  {
    id: 'library-reading',
    name: 'Czytelnia',
    description: 'Regały pod ścianami, stół pośrodku.',
    buildingTypes: ['library'],
    floors: 1,
    objects: [
      { type: 'shelf', u: -0.4, v: -0.3, floor: 0, rotationY: Math.PI / 2 },
      { type: 'shelf', u: 0.4, v: -0.3, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'table', u: 0, v: 0, floor: 0, rotationY: 0 },
      { type: 'chair', u: -0.15, v: 0.15, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0.15, v: 0.15, floor: 0, rotationY: Math.PI },
      { type: 'rug', u: 0, v: 0.05, floor: 0, rotationY: 0 },
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
      { type: 'wall', u: 0, v: 0, floor: 0, rotationY: Math.PI / 2, span: { axis: 'z', frac: 0.9 } },
      { type: 'door', u: 0, v: 0, floor: 0, rotationY: Math.PI / 2, anchor: 0 },
      { type: 'shelf', u: -0.3, v: -0.25, floor: 0, rotationY: Math.PI / 2 },
      { type: 'shelf', u: 0.3, v: -0.25, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'shelf', u: -0.3, v: 0.25, floor: 0, rotationY: Math.PI / 2 },
      { type: 'shelf', u: 0.3, v: 0.25, floor: 0, rotationY: -Math.PI / 2 },
      ...lamps(1),
    ],
  },
  {
    id: 'temple-hall',
    name: 'Sala główna',
    description: 'Świece i dywan prowadzą wzrok w głąb świątyni.',
    buildingTypes: ['temple'],
    floors: 1,
    objects: [
      { type: 'candle', u: 0, v: -0.3, floor: 0, rotationY: 0 },
      { type: 'rug', u: 0, v: 0, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0, v: 0.35, floor: 0, rotationY: Math.PI },
      ...lamps(1),
    ],
  },
  {
    id: 'temple-antechamber',
    name: 'Ołtarz i przedsionek',
    description: 'Mały przedsionek oddziela wejście od ołtarza.',
    buildingTypes: ['temple'],
    floors: 1,
    objects: [
      { type: 'wall', u: 0, v: 0.25, floor: 0, rotationY: 0, span: { axis: 'x', frac: 0.65 } },
      { type: 'door', u: 0, v: 0.25, floor: 0, rotationY: 0, anchor: 0 },
      { type: 'candle', u: 0, v: -0.25, floor: 0, rotationY: 0 },
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
      { type: 'fireplace', u: 0, v: -0.42, floor: 0, rotationY: 0 },
      { type: 'painting', u: -0.3, v: -0.46, floor: 0, rotationY: 0 },
      { type: 'clock', u: 0.4, v: -0.42, floor: 0, rotationY: 0 },
      { type: 'sofa', u: 0, v: 0.08, floor: 0, rotationY: Math.PI },
      { type: 'armchair', u: -0.3, v: -0.12, floor: 0, rotationY: Math.PI / 2 },
      { type: 'armchair', u: 0.3, v: -0.12, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'rug', u: 0, v: -0.15, floor: 0, rotationY: 0 },
      { type: 'table', u: 0.32, v: 0.3, floor: 0, rotationY: 0 },
      { type: 'vase', u: 0.32, v: 0.3, floor: 0, dy: 0.81, rotationY: 0, anchor: 7 },
      { type: 'curtains', u: -0.47, v: 0.15, floor: 0, rotationY: Math.PI / 2 },
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
      { type: 'bed', u: 0, v: -0.31, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0, v: -0.46, floor: 0, rotationY: 0 },
      { type: 'sideboard', u: 0.32, v: 0.44, floor: 0, rotationY: Math.PI },
      { type: 'vase', u: 0.32, v: 0.44, floor: 0, dy: 0.94, rotationY: 0, anchor: 2 },
      { type: 'mirror', u: -0.44, v: -0.1, floor: 0, rotationY: Math.PI / 2 },
      { type: 'curtains', u: 0.47, v: -0.1, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'rug', u: 0, v: 0.1, floor: 0, rotationY: 0 },
      { type: 'chair', u: -0.3, v: 0.35, floor: 0, rotationY: Math.PI / 2 },
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
      { type: 'desk', u: 0, v: -0.3, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: -0.17, floor: 0, rotationY: Math.PI },
      { type: 'shelf', u: -0.42, v: -0.3, floor: 0, rotationY: Math.PI / 2 },
      { type: 'shelf', u: -0.42, v: 0.05, floor: 0, rotationY: Math.PI / 2 },
      { type: 'clock', u: 0.42, v: -0.42, floor: 0, rotationY: 0 },
      { type: 'bust', u: 0.36, v: 0.3, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0.45, v: -0.1, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'rug', u: 0, v: -0.15, floor: 0, rotationY: 0 },
      { type: 'books', u: -0.1, v: 0.35, floor: 0, rotationY: 0.3 },
      ...lamps(1),
    ],
  },
  {
    id: 'house-dining',
    name: 'Jadalnia',
    description: 'Stół z krzesłami pośrodku, kredens pod ścianą, kandelabr na stole.',
    buildingTypes: ['house'],
    floors: 1,
    objects: [
      { type: 'table', u: 0, v: -0.05, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0, v: -0.05, floor: 0, dy: 0.81, rotationY: 0, anchor: 0 },
      { type: 'chair', u: -0.14, v: -0.17, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0.14, v: -0.17, floor: 0, rotationY: 0 },
      { type: 'chair', u: -0.14, v: 0.07, floor: 0, rotationY: Math.PI },
      { type: 'chair', u: 0.14, v: 0.07, floor: 0, rotationY: Math.PI },
      { type: 'sideboard', u: 0, v: -0.44, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0, v: -0.46, floor: 0, rotationY: 0 },
      { type: 'curtains', u: 0.47, v: 0, floor: 0, rotationY: -Math.PI / 2 },
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
      { type: 'rug', u: 0, v: 0.02, floor: 0, rotationY: 0, scale: [1.4, 1, 2.6] },
      { type: 'armchair', u: 0, v: -0.42, floor: 0, rotationY: 0 },
      { type: 'bust', u: -0.18, v: -0.43, floor: 0, rotationY: 0 },
      { type: 'bust', u: 0.18, v: -0.43, floor: 0, rotationY: 0 },
      { type: 'candle', u: -0.24, v: -0.3, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0.24, v: -0.3, floor: 0, rotationY: 0 },
      { type: 'candle', u: -0.24, v: -0.05, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0.24, v: -0.05, floor: 0, rotationY: 0 },
      { type: 'candle', u: -0.24, v: 0.2, floor: 0, rotationY: 0 },
      { type: 'candle', u: 0.24, v: 0.2, floor: 0, rotationY: 0 },
      { type: 'painting', u: -0.32, v: -0.47, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0.32, v: -0.47, floor: 0, rotationY: 0 },
      { type: 'curtains', u: -0.47, v: -0.2, floor: 0, rotationY: Math.PI / 2 },
      { type: 'curtains', u: 0.47, v: -0.2, floor: 0, rotationY: -Math.PI / 2 },
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
      { type: 'painting', u: -0.47, v: -0.34, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: -0.47, v: -0.11, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: -0.47, v: 0.12, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: -0.47, v: 0.35, floor: 0, rotationY: Math.PI / 2 },
      { type: 'painting', u: 0.47, v: -0.34, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: 0.47, v: -0.11, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: 0.47, v: 0.12, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: 0.47, v: 0.35, floor: 0, rotationY: -Math.PI / 2 },
      { type: 'painting', u: -0.22, v: -0.47, floor: 0, rotationY: 0 },
      { type: 'painting', u: 0.22, v: -0.47, floor: 0, rotationY: 0 },
      { type: 'bust', u: 0, v: -0.42, floor: 0, rotationY: 0 },
      { type: 'bust', u: -0.3, v: 0, floor: 0, rotationY: 0 },
      { type: 'bust', u: 0.3, v: 0, floor: 0, rotationY: 0 },
      { type: 'bench', u: 0, v: -0.15, floor: 0, rotationY: 0 },
      { type: 'bench', u: 0, v: 0.15, floor: 0, rotationY: Math.PI },
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
      { type: 'desk', u: 0, v: -0.2, floor: 0, rotationY: 0 },
      { type: 'chair', u: 0, v: -0.08, floor: 0, rotationY: Math.PI },
      { type: 'shelf', u: -0.24, v: -0.12, floor: 0, rotationY: Math.PI / 2 },
      { type: 'candle', u: 0.2, v: 0.12, floor: 0, rotationY: 0 },
      { type: 'clock', u: 0.22, v: -0.18, floor: 0, rotationY: 0 },
      { type: 'bed', u: 0, v: -0.14, floor: 1, rotationY: 0 },
      { type: 'sideboard', u: 0.22, v: 0.14, floor: 1, rotationY: Math.PI },
      { type: 'vase', u: 0.22, v: 0.14, floor: 1, dy: 0.94, rotationY: 0, anchor: 6 },
      ...lamps(2),
    ],
  },
  {
    id: 'empty-room',
    name: 'Pusty pokój',
    description: 'Czyste wnętrze bez podziałów — dobry punkt startowy.',
    floors: 1,
    objects: [
      ...lamps(1),],
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
      position: [po.u * spec.width, po.floor * spec.height + (po.dy ?? 0), po.v * spec.depth] as Vec3,
      rotation: yawRotation(po.rotationY),
      scale,
      anchorId,
      groupId,
    };
  });
  // własne presety sprzed kotwiczenia drzwi w ściance: drzwi-segment dostaje ściankę
  return attachLegacyDoors(objects, uid);
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
