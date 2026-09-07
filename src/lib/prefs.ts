import { useCallback, useState } from 'react';

/** Preferencje interfejsu (nie są częścią danych pałacu). */
const KEY = 'mneme.prefs.v1';

interface Prefs {
  library?: { collapsed?: string[]; hidden?: string[] };
  [k: string]: unknown;
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function getPref<T>(key: string, initial: T): T {
  const p = readPrefs();
  return (p[key] as T | undefined) ?? initial;
}

export function setPref<T>(key: string, value: T) {
  try {
    const p = readPrefs();
    p[key] = value;
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* brak miejsca — preferencja po prostu nie zostanie zapamiętana */
  }
}

/** Jak useState, ale wartość przeżywa odświeżenie strony. */
export function usePref<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => getPref(key, initial));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        setPref(key, next);
        return next;
      });
    },
    [key],
  );
  return [value, set];
}
