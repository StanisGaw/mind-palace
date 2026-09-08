/** Warstwy materiałów obiektów: rola → kolor domyślny. Klucze to role używane w `three/builders.ts`. */
export const MATERIAL_DEFAULTS = {
  cream: '#f3efe6',
  cream2: '#e8e2d5',
  stone: '#d9d4c7',
  stoneDark: '#b8b2a3',
  dome: '#9db6b0',
  domeDark: '#86a39c',
  roof: '#d9a689',
  roofDark: '#c58f72',
  wood: '#b98a5c',
  woodDark: '#8b6a4f',
  leaf: '#8fae7c',
  leaf2: '#7ea06d',
  leafDark: '#5e8a5f',
  cypress: '#4f7c5c',
  cypress2: '#5f8c68',
  water: '#a9d3e6',
  metal: '#4a4f4a',
  glow: '#ffe7a3',
  dark: '#3b3f3a',
  paper: '#f7f2e5',
  book1: '#c9705f',
  book2: '#6b8fb3',
  book3: '#d9b45a',
  flower1: '#e88a8a',
  flower2: '#f0c36b',
  flower3: '#c9a2d8',
  soil: '#8d7358',
  rock: '#8f8b82',
  rockDark: '#75726b',
  rockLight: '#a5a096',
  snow: '#f2f4f3',
  volcano: '#5e5852',
  volcanoDark: '#463f3b',
  lava: '#ff6a3d',
  fabric: '#7d8fa8',
  fabric2: '#bfc9d6',
  gold: '#c9a45c',
  velvet: '#8b3a3f',
  linen: '#efe9dc',
  glass: '#cfe3ef',
} as const;

export type MaterialRole = keyof typeof MATERIAL_DEFAULTS;

export const MATERIAL_ROLES: MaterialRole[] = Object.keys(MATERIAL_DEFAULTS) as MaterialRole[];

/** Nazwy warstw w panelu. */
export const MATERIAL_LABELS: Record<MaterialRole, string> = {
  cream: 'Mur jasny',
  cream2: 'Mur',
  stone: 'Kamień',
  stoneDark: 'Kamień ciemny',
  dome: 'Kopuła',
  domeDark: 'Akcent ciemny',
  roof: 'Dach',
  roofDark: 'Dach ciemny',
  wood: 'Drewno',
  woodDark: 'Drewno ciemne',
  leaf: 'Liście',
  leaf2: 'Liście jaśniejsze',
  leafDark: 'Liście ciemne',
  cypress: 'Igły',
  cypress2: 'Igły jaśniejsze',
  water: 'Woda',
  metal: 'Metal',
  glow: 'Światło',
  dark: 'Czerń',
  paper: 'Papier',
  book1: 'Książki (czerwone)',
  book2: 'Książki (niebieskie)',
  book3: 'Książki (żółte)',
  flower1: 'Kwiaty (róż)',
  flower2: 'Kwiaty (żółć)',
  flower3: 'Kwiaty (fiolet)',
  soil: 'Ziemia',
  rock: 'Skała',
  rockDark: 'Skała ciemna',
  rockLight: 'Skała jasna',
  snow: 'Śnieg',
  volcano: 'Wulkan',
  volcanoDark: 'Wulkan ciemny',
  lava: 'Lawa',
  fabric: 'Tkanina',
  fabric2: 'Tkanina jasna',
  gold: 'Złoto',
  velvet: 'Aksamit',
  linen: 'Len',
  glass: 'Szkło',
};

/** Warstwy, które rysują się ze słojami drewna — odcienie drewna ustawiają je parami. */
export const WOOD_ROLES: MaterialRole[] = ['wood', 'woodDark'];

export interface WoodShade {
  id: string;
  name: string;
  wood: string;
  woodDark: string;
}

export const WOOD_SHADES: WoodShade[] = [
  { id: 'oak', name: 'Dąb', wood: '#b98a5c', woodDark: '#8b6a4f' },
  { id: 'pine', name: 'Sosna', wood: '#d8b283', woodDark: '#a8865c' },
  { id: 'walnut', name: 'Orzech', wood: '#7a5236', woodDark: '#4e3323' },
  { id: 'cherry', name: 'Wiśnia', wood: '#9a4f3a', woodDark: '#6a3325' },
  { id: 'ebony', name: 'Heban', wood: '#3a2c25', woodDark: '#221a16' },
  { id: 'bleached', name: 'Bielone', wood: '#e3d5c2', woodDark: '#b8a58f' },
];

/** Kolory warstw obiektu po nadpisaniach użytkownika (tylko poprawne wartości `#rrggbb`). */
export function paletteOf(colors?: Record<string, string>): Record<MaterialRole, string> {
  if (!colors) return MATERIAL_DEFAULTS;
  const out: Record<string, string> = { ...MATERIAL_DEFAULTS };
  for (const role of MATERIAL_ROLES) {
    const v = colors[role];
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[role] = v.toLowerCase();
  }
  return out as Record<MaterialRole, string>;
}

/** Nadpisania bez wartości równych domyślnym — pusty wynik to `undefined` (pole znika z zapisu). */
export function trimColors(colors: Record<string, string>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors)) {
    if ((MATERIAL_DEFAULTS as Record<string, string>)[k] !== v.toLowerCase()) out[k] = v.toLowerCase();
  }
  return Object.keys(out).length ? out : undefined;
}
