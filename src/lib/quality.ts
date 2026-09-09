/**
 * Ustawienia jakości obrazu. Nie są częścią danych pałacu — ten sam pałac ogląda się na telefonie
 * i na komputerze, a to sprzęt decyduje, na co go stać.
 */
export type Quality = 'auto' | 'high' | 'medium' | 'low';

export const QUALITY_LABELS: Record<Quality, string> = {
  auto: 'Automatycznie',
  high: 'Wysoka',
  medium: 'Średnia',
  low: 'Niska',
};

export interface QualitySpec {
  /** Górna granica mnożnika pikseli. Ponad 2 nic już nie widać, a kosztuje kwadratowo. */
  pixelRatio: number;
  /** Bok mapy cienia w pikselach; 0 wyłącza cienie słońca. */
  shadowMap: number;
  /** Miękkie cienie (PCFSoft, 9 próbek) zamiast twardych (PCF, 4 próbki). */
  softShadows: boolean;
  /** Dolna granica automatycznego obniżania rozdzielczości, jako ułamek `pixelRatio`. */
  minScale: number;
}

const SPECS: Record<Exclude<Quality, 'auto'>, QualitySpec> = {
  high: { pixelRatio: 2, shadowMap: 2048, softShadows: true, minScale: 0.7 },
  medium: { pixelRatio: 1.5, shadowMap: 1024, softShadows: false, minScale: 0.6 },
  low: { pixelRatio: 1, shadowMap: 0, softShadows: false, minScale: 0.5 },
};

/**
 * Jakość dobrana do sprzętu, gdy użytkownik wybrał „automatycznie”. Ekran dotykowy to telefon albo
 * tablet — tam nawet mocny układ graficzny pracuje na baterii i dławi się przy 3× gęstości pikseli.
 */
export function autoQuality(env: { touch: boolean; cores: number }): Exclude<Quality, 'auto'> {
  if (env.touch) return 'medium';
  return env.cores <= 4 ? 'medium' : 'high';
}

export function qualitySpec(q: Quality, env: { touch: boolean; cores: number }): QualitySpec {
  return SPECS[q === 'auto' ? autoQuality(env) : q];
}

/** Cel automatu: schodzimy poniżej 40 kl./s, wracamy powyżej 55. Szeroki martwy zakres, żeby nie pulsowało. */
const DOWN_MS = 25;
const UP_MS = 18;

/**
 * Mnożnik rozdzielczości po klatce o średnim czasie `avgMs`. Obniżanie ratuje płynność tam, gdzie
 * żaden preset nie zgadnie: sześć domów w deszczu kosztuje wielokrotnie więcej niż pusta plansza.
 */
export function nextScale(scale: number, avgMs: number, min: number): number {
  if (avgMs > DOWN_MS) return Math.max(min, Math.round((scale - 0.1) * 100) / 100);
  if (avgMs < UP_MS) return Math.min(1, Math.round((scale + 0.1) * 100) / 100);
  return scale;
}
