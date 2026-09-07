import { useCurrentPalace, useStore } from '../store';
import type { Rating } from '../types';
import { I } from './Icons';

export function ReviewOverlay() {
  const review = useStore((s) => s.review)!;
  const palace = useCurrentPalace();
  const reveal = useStore((s) => s.reveal);
  const rate = useStore((s) => s.rate);
  const nextStop = useStore((s) => s.nextStop);
  const prevStop = useStore((s) => s.prevStop);
  const endReview = useStore((s) => s.endReview);
  const startReview = useStore((s) => s.startReview);
  const goToStop = useStore((s) => s.goToStop);
  const switchPalace = useStore((s) => s.switchPalace);
  const palaces = useStore((s) => s.data.palaces);
  const stop = review.stops[review.index];
  const stopPalace = palaces.find((p) => p.id === stop?.palaceId);
  const obj = stopPalace?.objects.find((o) => o.id === stop?.objectId);
  const total = review.stops.length;
  const pct = ((review.index + (review.finished ? 1 : 0)) / total) * 100;

  if (review.finished) {
    const counts: Record<Rating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
    for (const r of Object.values(review.results)) counts[r]++;
    const rated = Object.keys(review.results).length;
    return (
      <div className="review-overlay">
        <div className="head">
          <span className="chip warm"><span className="dot" /> Koniec spaceru</span>
          <button className="icon-btn" onClick={endReview} title="Zamknij"><I.X /></button>
        </div>
        <div className="progress"><i style={{ width: '100%' }} /></div>
        <div className="stop-name">Przeszedłeś całą trasę.</div>
        <div className="q">{rated > 0 ? `Oceniono ${rated} z ${total} przystanków. Terminy kolejnych powtórek zostały zaktualizowane.` : `Odwiedzono ${total} przystanków.`}</div>
        {rated > 0 && (
          <div className="summary">
            <div><b>{counts.again}</b>nie pamiętam</div>
            <div><b>{counts.hard}</b>trudne</div>
            <div><b>{counts.good}</b>dobre</div>
            <div><b>{counts.easy}</b>łatwe</div>
          </div>
        )}
        <div className="btns">
          <button className="btn" onClick={() => { endReview(); startReview(false); }}>Jeszcze raz</button>
          <button className="btn primary" onClick={() => { endReview(); switchPalace(review.rootId); }}>Wróć do edytora</button>
        </div>
      </div>
    );
  }

  if (!obj || !obj.note) return null;
  return (
    <div className="review-overlay">
      <div className="head">
        <span className="chip warm">
          <span className="dot" /> Przystanek {review.index + 1} z {total}
          {stop.depth > 0 && stopPalace ? ` · wnętrze: ${stopPalace.name}` : ''}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="icon-btn" onClick={prevStop} disabled={review.index === 0} title="Poprzedni"><I.Back /></button>
          <button className="icon-btn" onClick={() => goToStop(stop)} title="Pokaż ponownie"><I.Eye /></button>
          <button className="icon-btn" onClick={nextStop} title="Pomiń"><I.Chevron /></button>
          <button className="icon-btn" onClick={endReview} title="Zakończ (Esc)"><I.X /></button>
        </div>
      </div>
      <div className="progress"><i style={{ width: `${pct}%` }} /></div>
      <div className="stop-name">{obj.name}</div>
      {!review.revealed ? (
        <>
          <div className="q">Co tu zostawiłeś? Spróbuj sobie przypomnieć, zanim odsłonisz notatkę.</div>
          <div className="btns">
            <button className="btn primary" onClick={reveal}>Odsłoń wspomnienie</button>
          </div>
        </>
      ) : (
        <>
          <div className="note">
            <b>{obj.note.title}</b>
            {obj.note.body}
          </div>
          <div className="q" style={{ marginTop: 10 }}>Jak Ci poszło?</div>
          <div className="btns">
            <button className="btn rate again" onClick={() => rate('again')}>Nie pamiętam</button>
            <button className="btn rate hard" onClick={() => rate('hard')}>Trudne</button>
            <button className="btn rate good" onClick={() => rate('good')}>Dobrze</button>
            <button className="btn rate easy" onClick={() => rate('easy')}>Łatwe</button>
          </div>
        </>
      )}
    </div>
  );
}
