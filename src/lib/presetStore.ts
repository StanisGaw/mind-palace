import type { RoomPreset } from '../types';

/** Własne układy pokoi zapisane przez użytkownika (osobny klucz, poza danymi pałacu). */
const KEY = 'mneme.presets.v1';
const MAX = 30;

export function loadCustomPresets(): RoomPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((p) => p?.id && Array.isArray(p.objects)) : [];
  } catch {
    return [];
  }
}

export function saveCustomPresets(list: RoomPreset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* brak miejsca — preset po prostu nie zostanie zapamiętany */
  }
}
