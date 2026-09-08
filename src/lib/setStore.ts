import type { FurnitureSet } from '../types';
import { isLegacyPreset, setFromLegacyPreset } from './sets';

/** Własne zestawy mebli zapisane przez użytkownika (osobny klucz, poza danymi pałacu). */
const KEY = 'mneme.sets.v1';
/** Klucz sprzed zestawów — wczytujemy go raz i przeliczamy stare układy pokoi na zestawy. */
const LEGACY_KEY = 'mneme.presets.v1';
const MAX = 30;

/** Wpis z pamięci jako zestaw: stary układ pokoju przeliczamy na metry, nowy bierzemy wprost. */
export function asSet(raw: unknown): FurnitureSet | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.objects)) return null;
  if (isLegacyPreset(p)) return setFromLegacyPreset(p);
  return typeof p.id === 'string' ? ({ ...p, custom: true } as unknown as FurnitureSet) : null;
}

export function loadCustomSets(): FurnitureSet[] {
  const read = (key: string): FurnitureSet[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(raw) ? raw.map(asSet).filter((s): s is FurnitureSet => !!s) : [];
    } catch {
      return [];
    }
  };
  const own = read(KEY);
  if (own.length > 0) return own;
  // pierwsze uruchomienie po zmianie: przenosimy stare układy pokoi pod nowy klucz
  const legacy = read(LEGACY_KEY);
  if (legacy.length > 0) saveCustomSets(legacy);
  return legacy;
}

export function saveCustomSets(list: FurnitureSet[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* brak miejsca — zestaw po prostu nie zostanie zapamiętany */
  }
}
