import type { Rating, SrsState } from '../types';

const DAY = 24 * 60 * 60 * 1000;

export function newSrs(): SrsState {
  return { interval: 0, ease: 2.5, due: Date.now(), reps: 0, lapses: 0 };
}

/** Uproszczony SM-2. Zwraca nowy stan. */
export function reviewSrs(s: SrsState, rating: Rating, now = Date.now()): SrsState {
  let { interval, ease, reps, lapses } = s;
  if (rating === 'again') {
    reps = 0;
    lapses += 1;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    if (reps === 0) interval = rating === 'easy' ? 4 : 1;
    else if (reps === 1) interval = rating === 'easy' ? 7 : 3;
    else interval = Math.round(interval * ease * (rating === 'hard' ? 0.8 : rating === 'easy' ? 1.3 : 1));
    reps += 1;
    if (rating === 'hard') ease = Math.max(1.3, ease - 0.15);
    if (rating === 'easy') ease = Math.min(3.0, ease + 0.15);
  }
  const due = rating === 'again' ? now + 10 * 60 * 1000 : now + interval * DAY;
  return { interval, ease, reps, lapses, due, lastReview: now };
}

export function isDue(s: SrsState | undefined, now = Date.now()): boolean {
  return !!s && s.due <= now;
}

export function describeDue(s: SrsState, now = Date.now()): string {
  const diff = s.due - now;
  if (diff <= 0) return 'do powtórki teraz';
  const days = Math.round(diff / DAY);
  if (days === 0) return 'do powtórki dziś';
  if (days === 1) return 'jutro';
  return `za ${days} dni`;
}
