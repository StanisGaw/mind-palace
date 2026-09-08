import type { Category, RoomSpec, Scenery, Weather } from './types';
import type { AnimalKind } from './three/wildlife';

export interface CatalogItem {
  id: string;
  name: string;
  category: Category;
  description: string;
  emoji: string; // ikona w liście
  footprint: number; // przybliżony promień (do rozmieszczania)
  maxScale?: number; // górna granica suwaka wielkości (domyślnie 10)
  emitter?: 'smoke' | 'mist'; // system cząsteczek doczepiony do obiektu
  collider?: 'trimesh' | 'box' | 'cylinder' | 'none'; // bryła kolizji (domyślnie 'box')
  unique?: boolean; // tylko jeden taki obiekt na pałac (brama)
  spawn?: AnimalKind; // punkt pojawiania zwierzęcia
}

/** Bryła kolizji obiektu: dokładna siatka tam, gdzie kształt ma znaczenie (schody, zbocza). */
export function colliderKind(id: string): 'trimesh' | 'box' | 'cylinder' | 'none' {
  const item = CATALOG.find((c) => c.id === id);
  if (item?.collider) return item.collider;
  if (!item) return 'box';
  if (item.category === 'animal') return 'none';
  if (item.category === 'building' || item.category === 'landscape' || item.category === 'special') return 'trimesh';
  return 'box';
}

export const CATALOG: CatalogItem[] = [
  // Budynki
  { id: 'palace', name: 'Pałac', category: 'building', emoji: '🏛️', description: 'Kopuła i kolumnada — miejsce na najważniejsze idee.', footprint: 2.4 },
  { id: 'library', name: 'Biblioteka', category: 'building', emoji: '📚', description: 'Budynek z portykiem, dobry na wiedzę i fakty.', footprint: 2.2 },
  { id: 'temple', name: 'Świątynia', category: 'building', emoji: '⛩️', description: 'Mały pawilon z dachem dwuspadowym.', footprint: 1.8 },
  { id: 'tower', name: 'Wieża', category: 'building', emoji: '🗼', description: 'Wysoka wieża widoczna z każdego miejsca.', footprint: 1.2 },
  { id: 'house', name: 'Domek', category: 'building', emoji: '🏠', description: 'Przytulny domek z kominem.', footprint: 1.6 },
  { id: 'gazebo', name: 'Altana', category: 'building', emoji: '⛺', description: 'Otwarta altana ogrodowa.', footprint: 1.5, collider: 'trimesh' },
  // Przedmioty
  { id: 'fountain', name: 'Fontanna', category: 'object', emoji: '⛲', description: 'Woda w centrum ogrodu.', footprint: 1.4, collider: 'trimesh' },
  { id: 'bench', name: 'Ławka', category: 'object', emoji: '🪑', description: 'Miejsce, by usiąść z myślą.', footprint: 0.8, collider: 'trimesh' },

  { id: 'books', name: 'Książki', category: 'object', emoji: '📖', description: 'Stos książek — dobry na listy.', footprint: 0.5 },
  { id: 'statue', name: 'Posąg', category: 'object', emoji: '🗿', description: 'Postać na cokole.', footprint: 0.7 },
  { id: 'obelisk', name: 'Obelisk', category: 'object', emoji: '🔺', description: 'Kamienny znak pamięci.', footprint: 0.6 },
  { id: 'chest', name: 'Skrzynia', category: 'object', emoji: '🧰', description: 'Skrzynia na sekrety.', footprint: 0.6 },
  { id: 'signpost', name: 'Drogowskaz', category: 'object', emoji: '🪧', description: 'Wskazuje kierunek historii.', footprint: 0.4 },
  { id: 'well', name: 'Studnia', category: 'object', emoji: '🪣', description: 'Głębokie skojarzenia.', footprint: 0.8, collider: 'trimesh' },
  // Rośliny
  { id: 'tree', name: 'Drzewo', category: 'plant', emoji: '🌳', description: 'Okrągła korona, cień na myśli.', footprint: 1.2, collider: 'cylinder' },
  { id: 'cypress', name: 'Cyprys', category: 'plant', emoji: '🌲', description: 'Smukłe drzewo — dobry punkt orientacyjny.', footprint: 0.6, collider: 'cylinder' },
  { id: 'bush', name: 'Krzew', category: 'plant', emoji: '🌿', description: 'Niski krzew do obramowania ścieżki.', footprint: 0.6 },
  { id: 'flowers', name: 'Kwietnik', category: 'plant', emoji: '🌷', description: 'Kolorowa rabata.', footprint: 0.8, collider: 'box' },
  { id: 'palm', name: 'Palma', category: 'plant', emoji: '🌴', description: 'Egzotyczny akcent.', footprint: 0.9, collider: 'cylinder' },
  // Krajobraz
  { id: 'mountain', name: 'Góra', category: 'landscape', emoji: '⛰️', description: 'Skalny masyw ze śniegiem na szczycie.', footprint: 3.4, maxScale: 20 },
  { id: 'volcano', name: 'Wulkan', category: 'landscape', emoji: '🌋', description: 'Krater z lawą i słupem dymu.', footprint: 3.4, maxScale: 20, emitter: 'smoke' },
  { id: 'rock', name: 'Głaz', category: 'landscape', emoji: '🪨', description: 'Kamień, na który da się wejść.', footprint: 1.0, maxScale: 20 },
  { id: 'hill', name: 'Wzgórze', category: 'landscape', emoji: '🏞️', description: 'Łagodne wzniesienie z krzewami.', footprint: 2.8, maxScale: 20 },
  { id: 'pond', name: 'Staw', category: 'landscape', emoji: '💧', description: 'Woda w kamiennej obudowie.', footprint: 2.2, maxScale: 20 },
  { id: 'waterfall', name: 'Wodospad', category: 'landscape', emoji: '🏔️', description: 'Woda spadająca ze skalnej ściany.', footprint: 2.2, maxScale: 20, emitter: 'mist' },
  // Wyposażenie wnętrz
  { id: 'table', name: 'Stół', category: 'furniture', emoji: '🪵', description: 'Blat na notatki i mapy.', footprint: 0.9, collider: 'trimesh' },
  { id: 'shelf', name: 'Regał', category: 'furniture', emoji: '🗄️', description: 'Półki pełne tomów.', footprint: 0.7, collider: 'box' },
  { id: 'chair', name: 'Krzesło', category: 'furniture', emoji: '💺', description: 'Miejsce do namysłu.', footprint: 0.4, collider: 'trimesh' },
  { id: 'painting', name: 'Obraz', category: 'furniture', emoji: '🖼️', description: 'Płótno na sztaludze.', footprint: 0.5 },
  { id: 'rug', name: 'Dywan', category: 'furniture', emoji: '🧶', description: 'Miękki akcent na podłodze.', footprint: 1.2, collider: 'none' },
  // Oświetlenie
  { id: 'lantern', name: 'Latarnia', category: 'lighting', emoji: '🏮', description: 'Światło prowadzące ścieżką.', footprint: 0.4 },
  { id: 'torch', name: 'Pochodnia', category: 'lighting', emoji: '🔥', description: 'Płomień na drewnianym drzewcu.', footprint: 0.3 },
  { id: 'lampion', name: 'Lampion', category: 'lighting', emoji: '🎐', description: 'Papierowa kula światła na słupku.', footprint: 0.35 },
  { id: 'campfire', name: 'Ognisko', category: 'lighting', emoji: '🪵', description: 'Krąg kamieni i trzaskający ogień.', footprint: 0.9, emitter: 'smoke', collider: 'cylinder' },
  { id: 'candle', name: 'Kandelabr', category: 'lighting', emoji: '🕯️', description: 'Ciepłe światło świec.', footprint: 0.3 },
  // Zwierzęta (punkty pojawiania — ożywają w trybie chodzenia)
  { id: 'spawn_bird', name: 'Ptaki', category: 'animal', emoji: '🐦', description: 'Stadko krąży nad okolicą i siada na dachach.', footprint: 0.5, collider: 'none', spawn: 'bird' },
  { id: 'spawn_dog', name: 'Pies', category: 'animal', emoji: '🐕', description: 'Biega w pobliżu, podbiega do Ciebie i merda ogonem.', footprint: 0.5, collider: 'none', spawn: 'dog' },
  { id: 'spawn_cat', name: 'Kot', category: 'animal', emoji: '🐈', description: 'Wędruje po okolicy i ucieka, gdy podejdziesz za blisko.', footprint: 0.5, collider: 'none', spawn: 'cat' },
  { id: 'spawn_squirrel', name: 'Wiewiórka', category: 'animal', emoji: '🐿️', description: 'Biega między drzewami, wspina się przy zagrożeniu.', footprint: 0.4, collider: 'none', spawn: 'squirrel' },
  { id: 'spawn_wolf', name: 'Wilk', category: 'animal', emoji: '🐺', description: 'Patroluje teren i warczy z bezpiecznej odległości.', footprint: 0.6, collider: 'none', spawn: 'wolf' },
  { id: 'spawn_dragon', name: 'Smok', category: 'animal', emoji: '🐉', description: 'Krąży wysoko, przelatuje nad głową i zionie ogniem.', footprint: 0.8, collider: 'none', spawn: 'dragon' },
  // Specjalne
  { id: 'gate', name: 'Brama wejściowa', category: 'special', emoji: '🚪', description: 'Tu zaczyna się spacer po pałacu. Może być tylko jedna.', footprint: 1.6, collider: 'trimesh', unique: true },
  // Konstrukcja (tylko we wnętrzach — układ pokoju z elementów biblioteki)
  { id: 'wall', name: 'Ściana działowa', category: 'structure', emoji: '🧱', description: 'Dzieli pokój na mniejsze przestrzenie.', footprint: 1.0, collider: 'box', maxScale: 12 },
  { id: 'door', name: 'Drzwi', category: 'structure', emoji: '🚪', description: 'Otwierane skrzydło — kliknij albo naciśnij F.', footprint: 1.0, collider: 'trimesh' },
  { id: 'window', name: 'Okno', category: 'structure', emoji: '🪟', description: 'Przyciąga się do najbliższej ściany obwodowej.', footprint: 0.6, collider: 'none' },
  { id: 'stairs', name: 'Schody', category: 'structure', emoji: '🪜', description: 'Prowadzą na wyższe piętro.', footprint: 0.8, collider: 'trimesh', maxScale: 2 },
];

export const CATEGORY_ORDER: Category[] = ['structure', 'building', 'lighting', 'furniture', 'plant', 'landscape', 'object', 'animal', 'special'];

/** Wnętrza budynków: wymiary pokoju wchodzimy do środka. Altana jest otwarta — nie ma wnętrza. */
export const ROOMS: Record<string, RoomSpec> = {
  palace: { width: 14, depth: 12, height: 5.2, windows: 4, floor: '#d9d4c7', wall: '#f3efe6' },
  library: { width: 12, depth: 10, height: 4.6, windows: 3, floor: '#cfc7b4', wall: '#f1ece0' },
  temple: { width: 8, depth: 8, height: 4.2, windows: 2, floor: '#d3cec1', wall: '#efeade' },
  tower: { width: 6, depth: 6, height: 6, windows: 4, floor: '#c9c3b3', wall: '#ece7db' },
  house: { width: 8, depth: 7, height: 3.2, windows: 2, floor: '#c8b294', wall: '#f4efe3' },
};

/** Rodzaj zwierzęcia dla punktu pojawiania (albo null dla zwykłych obiektów). */
export function spawnKind(type: string): AnimalKind | null {
  return CATALOG.find((c) => c.id === type)?.spawn ?? null;
}

export function hasInterior(type: string): boolean {
  return type in ROOMS;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  building: 'Budynki',
  lighting: 'Oświetlenie',
  furniture: 'Wyposażenie',
  plant: 'Rośliny',
  landscape: 'Krajobraz',
  object: 'Przedmioty',
  animal: 'Zwierzęta',
  special: 'Specjalne',
  structure: 'Konstrukcja',
};

export interface SceneryPreset {
  id: Scenery;
  name: string;
  amp: number; // amplituda wzniesień
  freq: number; // częstotliwość szumu
  octaves: number;
  ridge: boolean; // ostre grzbiety (góry)
  water: number | null; // poziom wody albo brak
  slopeX: number; // nachylenie wzdłuż osi X (wybrzeże schodzące do morza)
  // paleta wysokościowa: kolor od podanej wysokości w górę
  palette: { h: number; color: string }[];
}

export const SCENERIES: SceneryPreset[] = [
  { id: 'none', name: 'Bez otoczenia', amp: 0, freq: 0, octaves: 1, ridge: false, water: null, slopeX: 0, palette: [{ h: -99, color: '#cfd6c4' }] },
  {
    id: 'meadow',
    name: 'Łąki',
    amp: 3.2, freq: 0.045, octaves: 4, ridge: false, water: null, slopeX: 0,
    palette: [
      { h: -99, color: '#b9c4a6' },
      { h: 0.6, color: '#a8bb90' },
      { h: 2.2, color: '#93ac7d' },
      { h: 4.5, color: '#7e9a6c' },
    ],
  },
  {
    id: 'mountains',
    name: 'Góry',
    amp: 42, freq: 0.011, octaves: 4, ridge: true, water: null, slopeX: 0,
    palette: [
      { h: -99, color: '#9fb289' },
      { h: 3, color: '#88a07a' },
      { h: 8, color: '#7d8a6f' },
      { h: 13, color: '#93917f' },
      { h: 19, color: '#8d8a83' },
      { h: 25, color: '#d8dcda' },
      { h: 30, color: '#f4f7f6' },
    ],
  },
  {
    id: 'coast',
    name: 'Wybrzeże',
    amp: 5.5, freq: 0.03, octaves: 4, ridge: false, water: -0.9, slopeX: 1,
    palette: [
      { h: -99, color: '#bda87e' },
      { h: -1.6, color: '#cdbb92' },
      { h: 0.2, color: '#e2d3ae' },
      { h: 1.6, color: '#b3bf95' },
      { h: 4, color: '#94ab7c' },
    ],
  },
  {
    id: 'desert',
    name: 'Pustynia',
    amp: 6, freq: 0.016, octaves: 3, ridge: false, water: null, slopeX: 0,
    palette: [
      { h: -99, color: '#d9bd8c' },
      { h: 1.2, color: '#e6d2a0' },
      { h: 3.5, color: '#efe0b8' },
    ],
  },
];

export function sceneryPreset(id: Scenery): SceneryPreset {
  return SCENERIES.find((s) => s.id === id) ?? SCENERIES[1];
}

export const WEATHERS: { id: Weather; name: string }[] = [
  { id: 'clear', name: 'Bezchmurnie' },
  { id: 'cloudy', name: 'Pochmurno' },
  { id: 'rain', name: 'Deszcz' },
  { id: 'snow', name: 'Śnieg' },
  { id: 'fog', name: 'Mgła' },
  { id: 'storm', name: 'Burza' },
];

export const AMBIENCES: { id: string; name: string; sky: string; ground: string; fog: string }[] = [
  { id: 'garden', name: 'Spokojny ogród', sky: '#eceeea', ground: '#cfd6c4', fog: '#eceeea' },
  { id: 'dawn', name: 'Świt', sky: '#f6e7dc', ground: '#d8d1bd', fog: '#f6e7dc' },
  { id: 'dusk', name: 'Zmierzch', sky: '#d9d5e6', ground: '#b9bcc9', fog: '#d9d5e6' },
  { id: 'night', name: 'Noc', sky: '#1f2430', ground: '#2f3a3a', fog: '#1f2430' },
];

export function catalogItem(id: string): CatalogItem {
  return CATALOG.find((c) => c.id === id) ?? CATALOG[0];
}
