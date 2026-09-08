import { useEffect, useState } from 'react';

/** Wąski ekran: panele jako szuflady, dolny pasek nawigacji. */
export const PHONE_Q = '(max-width: 900px)';
/** Telefon obrócony poziomo: za mało wysokości na jakąkolwiek belkę — sam widok z pływającymi przyciskami. */
export const LANDSCAPE_Q = '(pointer: coarse) and (orientation: landscape) and (max-height: 520px)';
/** Sterowanie dotykiem (bez najechania i skrótów klawiszowych). */
export const COARSE_Q = '(pointer: coarse)';

/** Jak `matchMedia`, ale reaguje na obrót ekranu i zmianę rozmiaru okna. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' ? matchMedia(query).matches : false));
  useEffect(() => {
    const mq = matchMedia(query);
    const h = () => setMatch(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return match;
}
