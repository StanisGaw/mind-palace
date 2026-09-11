import { describe, expect, it } from 'vitest';
import { assignSlots, type LightSlot, type LightSource } from './lightpool';

const src = (...scores: number[]): LightSource[] => scores.map((score, i) => ({ id: `s${i}`, score }));
const allDark = () => true;
const noneDark = () => false;

/** Miejsca zajęte przez źródła, w kolejności puli (null = wolne). */
const sources = (slots: LightSlot[]) => slots.map((s) => (s.on ? s.source : null));

describe('assignSlots', () => {
  it('pusta pula obsadza się najlepszymi źródłami', () => {
    const out = assignSlots([], src(5, 1, 3, 9), 2, allDark);
    expect(out).toHaveLength(2);
    expect(new Set(sources(out))).toEqual(new Set(['s1', 's2'])); // wyniki 1 i 3
  });

  it('mniej źródeł niż miejsc — reszta zostaje pusta, ale pula ma pełny rozmiar', () => {
    const out = assignSlots([], src(2), 4, allDark);
    expect(out).toHaveLength(4);
    expect(out.filter((s) => s.on)).toHaveLength(1);
  });

  it('brak źródeł gasi całą pulę', () => {
    const start = assignSlots([], src(1, 2), 2, allDark);
    const out = assignSlots(start, [], 2, allDark);
    expect(out.every((s) => !s.on)).toBe(true);
  });

  it('źródło tuż za pulą nie odbiera miejsca (histereza)', () => {
    const start = assignSlots([], src(1, 2), 2, allDark);
    // s2 jest odrobinę lepsze od s1, ale s1 wciąż mieści się w n + 2 — nic się nie przestawia
    const out = assignSlots(start, [...src(1, 2), { id: 's2', score: 1.5 }], 2, allDark);
    expect(new Set(sources(out))).toEqual(new Set(['s0', 's1']));
  });

  it('źródło, które wypadło daleko poza czołówkę, gaśnie', () => {
    const start = assignSlots([], src(1, 2), 2, allDark);
    const far = [{ id: 's0', score: 1 }, { id: 's1', score: 99 }, { id: 'a', score: 2 }, { id: 'b', score: 3 }, { id: 'c', score: 4 }];
    const out = assignSlots(start, far, 2, noneDark);
    const s1 = out.find((s) => s.source === 's1')!;
    expect(s1.on).toBe(false);
  });

  it('gasnące miejsce nie przyjmuje nowego źródła, dopóki nie jest ciemne', () => {
    const start = assignSlots([], src(1, 2), 2, allDark);
    const far = [{ id: 's0', score: 1 }, { id: 's1', score: 99 }, { id: 'a', score: 2 }, { id: 'b', score: 3 }, { id: 'c', score: 4 }];
    const fading = assignSlots(start, far, 2, noneDark);
    expect(fading.find((s) => s.source === 's1')!.on).toBe(false);
    // dopiero gdy miejsce zgaśnie, wchodzi w nie „a”
    const after = assignSlots(fading, far, 2, allDark);
    expect(new Set(sources(after))).toEqual(new Set(['s0', 'a']));
  });

  it('to samo źródło nie trafia do dwóch miejsc', () => {
    const out = assignSlots([], src(1, 2, 3), 3, allDark);
    const ids = sources(out).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('zmniejszenie puli skraca ją do n miejsc', () => {
    const start = assignSlots([], src(1, 2, 3, 4, 5, 6, 7, 8), 8, allDark);
    expect(start.filter((s) => s.on)).toHaveLength(8);
    const out = assignSlots(start, src(1, 2, 3, 4, 5, 6, 7, 8), 3, allDark);
    expect(out).toHaveLength(3);
  });

  it('powiększenie puli dokłada miejsca i obsadza je kolejnymi źródłami', () => {
    const start = assignSlots([], src(1, 2, 3, 4), 2, allDark);
    const out = assignSlots(start, src(1, 2, 3, 4), 4, allDark);
    expect(out).toHaveLength(4);
    expect(new Set(sources(out))).toEqual(new Set(['s0', 's1', 's2', 's3']));
  });

  it('stabilność: przy niezmienionych źródłach przydział się nie rusza', () => {
    const list = src(4, 1, 7, 2, 9);
    let slots = assignSlots([], list, 3, allDark);
    const first = sources(slots);
    for (let i = 0; i < 5; i++) slots = assignSlots(slots, list, 3, allDark);
    expect(sources(slots)).toEqual(first);
  });
});
