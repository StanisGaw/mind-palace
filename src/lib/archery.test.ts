/**
 * Łucznictwo: naciąg i tor lotu to czysta arytmetyka, więc sprawdzamy ją tutaj, zanim scena przepisze
 * wynik na model strzały. Najważniejsza jest wielkość spadku toru — od niej zależy, czy strzelanie
 * wymaga mierzenia wyżej (ma), ale nie wymaga liczenia (nie może).
 */
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog';
import { DRAW_TIME, HOLD_STEADY, SPEED_FULL, SPEED_SLACK, arrowSpeed, drawStrength, newArrow, stepArrow, sway, type ArrowState } from './archery';

/**
 * Leci, aż minie `distance` metrów w poziomie; zwraca spadek toru w tym punkcie. Krok jest drobny,
 * żeby pomiar nie przestrzeliwał celu — przy klatce 1/60 strzała robi prawie metr na krok.
 */
function dropOver(distance: number, speed: number, dt = 1 / 480): number {
  const a: ArrowState = newArrow([0, 1.6, 0], [0, 0, -1], speed);
  while (-a.z < distance && a.t < 5) stepArrow(a, dt);
  return 1.6 - a.y;
}

describe('naciąg', () => {
  it('dochodzi do pełna w czasie naciągu i dalej nie rośnie', () => {
    expect(drawStrength(0)).toBe(0);
    expect(drawStrength(DRAW_TIME / 2)).toBeCloseTo(0.5, 5);
    expect(drawStrength(DRAW_TIME)).toBe(1);
    expect(drawStrength(DRAW_TIME * 3)).toBe(1);
  });

  it('prędkość wylotowa rośnie z naciągiem', () => {
    expect(arrowSpeed(0)).toBe(SPEED_SLACK);
    expect(arrowSpeed(1)).toBe(SPEED_FULL);
    expect(arrowSpeed(0.25)).toBeCloseTo(28, 0);
    expect(arrowSpeed(0.5)).toBeGreaterThan(arrowSpeed(0.25));
  });

  it('ręka drży dopiero po dłuższym trzymaniu pełnego naciągu', () => {
    expect(sway(0, 0.3)).toEqual([0, 0]);
    expect(sway(HOLD_STEADY, 0.3)).toEqual([0, 0]);
    const [x, y] = sway(HOLD_STEADY + 3, 0.3);
    expect(Math.abs(x) + Math.abs(y)).toBeGreaterThan(0);
    // amplituda jest mała: pełne drżenie to setne części radiana, nie „wyrwany" celownik
    expect(Math.abs(x)).toBeLessThan(0.01);
  });
});

describe('lot strzały', () => {
  it('przy pełnym naciągu spada na 18 m tyle, że widać to na celowniku, ale nie trzeba liczyć', () => {
    const drop = dropOver(18, SPEED_FULL);
    expect(drop).toBeGreaterThan(0.3);
    expect(drop).toBeLessThan(0.8);
  });

  it('słabszy naciąg to wyraźnie bardziej krzywy tor', () => {
    expect(dropOver(18, arrowSpeed(0.3))).toBeGreaterThan(dropOver(18, SPEED_FULL) * 1.8);
  });

  it('z bliska tor jest praktycznie prosty', () => {
    expect(dropOver(8, SPEED_FULL)).toBeLessThan(0.12);
  });

  it('wynik nie zależy od długości kroku (60 i 240 klatek na sekundę)', () => {
    expect(dropOver(18, SPEED_FULL, 1 / 240)).toBeCloseTo(dropOver(18, SPEED_FULL, 1 / 60), 1);
  });

  it('krok zwraca odcinek, na którym scena szuka trafienia', () => {
    const a = newArrow([0, 2, 0], [0, 0, -1], SPEED_FULL);
    const s = stepArrow(a, 1 / 60);
    expect(s.len).toBeCloseTo(SPEED_FULL / 60, 1);
    expect([s.x0, s.y0, s.z0]).toEqual([0, 2, 0]);
    expect(s.z1).toBeCloseTo(a.z, 6);
  });

  it('opór powietrza hamuje strzałę w locie', () => {
    const a = newArrow([0, 2, 0], [0, 0, -1], SPEED_FULL);
    for (let i = 0; i < 60; i++) stepArrow(a, 1 / 60);
    expect(Math.abs(a.vz)).toBeLessThan(SPEED_FULL);
    expect(Math.abs(a.vz)).toBeGreaterThan(SPEED_FULL * 0.8);
  });
});

describe('katalog strzelnicy', () => {
  it('tarcza łucznicza stoi w bibliotece z dokładną bryłą kolizji', () => {
    const target = CATALOG.find((c) => c.id === 'archery_target');
    expect(target, 'brak tarczy w katalogu').toBeDefined();
    // strzała trafia w to, co widać, więc tarcza nie może mieć pudła zamiast siatki
    expect(target!.collider).toBe('trimesh');
  });
});
