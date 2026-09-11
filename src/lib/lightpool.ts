/**
 * Pula świateł punktowych: stała liczba miejsc, zmienne źródła. Three.js buduje osobny program shadera
 * dla każdej liczby widocznych świateł, więc zapalanie i gaszenie latarni przez `visible` kosztuje
 * rekompilację **wszystkich** materiałów sceny — przy 55 latarniach w mieście to kilkadziesiąt programów
 * i sekundowe zacięcia przy każdym obrocie widoku. Dlatego w scenie świeci zawsze tyle samo świateł,
 * a zmienia się tylko to, które źródło obsadza które miejsce.
 *
 * Czysta arytmetyka: scena podaje wyniki źródeł i pyta, co ma być w którym miejscu.
 */

/** Źródło światła (latarnia, neon, lampa sufitowa) z miarą „jak bardzo warto je teraz zapalić”. */
export interface LightSource {
  id: string;
  /** Im mniej, tym bliżej: odległość od kamery pomniejszona o zasięg światła. */
  score: number;
}

/** Jedno miejsce w puli: obsadzone źródło i to, czy ma świecić, czy właśnie gaśnie. */
export interface LightSlot {
  source: string | null;
  on: boolean;
}

/**
 * Zapas nad rozmiar puli, w którym źródło utrzymuje swoje miejsce. Bez niego dwa źródła o niemal równym
 * wyniku zamieniałyby się miejscami przy każdym przeliczeniu i mrugały.
 */
const KEEP = 2;

/**
 * Nowy przydział źródeł do miejsc. Miejsce, które wypadło z czołówki, najpierw gaśnie (`on: false`)
 * i dopiero gdy jest ciemne (`dark`), przyjmuje nowe źródło — inaczej jedna latarnia zmieniałaby się
 * w drugą w pół blasku. Wynik ma zawsze `n` miejsc, więc zmiana jakości skraca albo wydłuża pulę.
 */
export function assignSlots(slots: LightSlot[], sources: LightSource[], n: number, dark: (slot: number) => boolean): LightSlot[] {
  const ranked = [...sources].sort((a, b) => a.score - b.score);
  const rank = new Map<string, number>();
  ranked.forEach((s, i) => rank.set(s.id, i));

  const out: LightSlot[] = [];
  for (let i = 0; i < n; i++) {
    const prev = slots[i];
    out.push(prev ? { source: prev.source, on: prev.on } : { source: null, on: false });
  }

  // 1. miejsca obsadzone: zostają, dopóki źródło trzyma się czołówki `n + KEEP`
  const taken = new Set<string>();
  for (const slot of out) {
    if (slot.source === null) continue;
    const r = rank.get(slot.source);
    if (r === undefined || r >= n + KEEP) {
      slot.on = false;
      continue;
    }
    slot.on = true;
    taken.add(slot.source);
  }

  // 2. wolne (ciemne) miejsca dostają najlepsze źródła spoza puli
  const waiting = ranked.slice(0, n).filter((s) => !taken.has(s.id));
  let k = 0;
  for (let i = 0; i < n && k < waiting.length; i++) {
    const slot = out[i];
    if (slot.on) continue;
    if (slot.source !== null && !dark(i)) continue; // jeszcze gaśnie — nie odbieramy mu miejsca
    slot.source = waiting[k++].id;
    slot.on = true;
  }
  return out;
}
