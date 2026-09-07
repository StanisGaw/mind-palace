import type { PalaceSettings } from '../types';

/** Zapisany zestaw ustawień otoczenia (bez obiektów pałacu). */
export interface LandscapePreset {
  id: string;
  name: string;
  builtin?: boolean;
  settings: Pick<PalaceSettings, 'scenery' | 'seed' | 'weather' | 'ambience' | 'ground' | 'groundTexture'>;
}

const KEY = 'mneme.landscapes.v1';

export const BUILTIN_LANDSCAPES: LandscapePreset[] = [
  {
    id: 'b_alpine',
    name: 'Alpejska dolina',
    builtin: true,
    settings: { scenery: 'mountains', seed: 8123, weather: 'cloudy', ambience: 'dawn', ground: { width: 30, depth: 30, shape: 'rect' }, groundTexture: 'grass' },
  },
  {
    id: 'b_oasis',
    name: 'Pustynna oaza',
    builtin: true,
    settings: { scenery: 'desert', seed: 4477, weather: 'clear', ambience: 'garden', ground: { width: 28, depth: 28, shape: 'circle' }, groundTexture: 'sand' },
  },
  {
    id: 'b_coast',
    name: 'Nocne wybrzeże',
    builtin: true,
    settings: { scenery: 'coast', seed: 9021, weather: 'fog', ambience: 'night', ground: { width: 32, depth: 32, shape: 'hex' }, groundTexture: 'stone' },
  },
];

export function loadLandscapes(): LandscapePreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((p) => p?.id && p?.settings) : [];
  } catch {
    return [];
  }
}

export function saveLandscape(name: string, settings: PalaceSettings): LandscapePreset {
  const entry: LandscapePreset = {
    id: 'l_' + Date.now().toString(36),
    name: name.trim().slice(0, 32) || 'Mój krajobraz',
    settings: {
      scenery: settings.scenery,
      seed: settings.seed,
      weather: settings.weather,
      ambience: settings.ambience,
      ground: { ...settings.ground },
      groundTexture: settings.groundTexture,
    },
  };
  const list = [...loadLandscapes(), entry];
  localStorage.setItem(KEY, JSON.stringify(list));
  return entry;
}

export function removeLandscape(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadLandscapes().filter((p) => p.id !== id)));
}

export function allLandscapes(): LandscapePreset[] {
  return [...BUILTIN_LANDSCAPES, ...loadLandscapes()];
}
