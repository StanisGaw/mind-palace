import { describe, expect, it } from 'vitest';
import { autoQuality, nextScale, qualitySpec } from './quality';

describe('autoQuality', () => {
  it('daje telefonowi średnią, mocnemu komputerowi wysoką', () => {
    expect(autoQuality({ touch: true, cores: 8 })).toBe('medium');
    expect(autoQuality({ touch: false, cores: 12 })).toBe('high');
    expect(autoQuality({ touch: false, cores: 2 })).toBe('medium');
  });
});

describe('qualitySpec', () => {
  it('niska jakość wyłącza cienie i nie skaluje pikseli', () => {
    const s = qualitySpec('low', { touch: false, cores: 8 });
    expect(s.shadowMap).toBe(0);
    expect(s.pixelRatio).toBe(1);
  });

  it('auto rozwija się do konkretnego presetu', () => {
    expect(qualitySpec('auto', { touch: true, cores: 8 })).toEqual(qualitySpec('medium', { touch: false, cores: 8 }));
  });
});

describe('nextScale', () => {
  it('obniża przy wolnych klatkach i nie schodzi poniżej progu', () => {
    expect(nextScale(1, 30, 0.6)).toBeCloseTo(0.9);
    expect(nextScale(0.6, 40, 0.6)).toBe(0.6);
  });

  it('wraca w górę przy szybkich klatkach, ale nie powyżej 1', () => {
    expect(nextScale(0.8, 10, 0.6)).toBeCloseTo(0.9);
    expect(nextScale(1, 5, 0.6)).toBe(1);
  });

  it('w martwym zakresie nie rusza mnożnika', () => {
    expect(nextScale(0.8, 21, 0.6)).toBe(0.8);
  });

  it('nie oscyluje: po zejściu z 1 klatka mieszcząca się w zakresie zostaje', () => {
    let s = 1;
    for (const ms of [30, 26, 21, 20, 22]) s = nextScale(s, ms, 0.6);
    expect(s).toBeCloseTo(0.8);
  });
});
