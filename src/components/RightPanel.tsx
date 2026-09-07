import { useEffect, useState } from 'react';
import { catalogItem, hasInterior } from '../catalog';
import { describeDue, isDue } from '../lib/srs';
import { useCurrentPalace, useStore } from '../store';
import { usePref } from '../lib/prefs';
import type { Vec3 } from '../types';
import { I } from './Icons';

export function RightPanel() {
  const selectedId = useStore((s) => s.selectedId);
  const palace = useCurrentPalace();
  const obj = palace.objects.find((o) => o.id === selectedId);
  return <aside className="panel right">{obj ? <Inspector key={obj.id} id={obj.id} /> : <Welcome />}</aside>;
}

function Welcome() {
  const palace = useCurrentPalace();
  const review = useStore((s) => s.review);
  const select = useStore((s) => s.select);
  const flyTo = useStore((s) => s.flyTo);
  const movePath = useStore((s) => s.movePath);
  const byId = new Map(palace.objects.map((o) => [o.id, o]));
  const path = palace.path.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o);
  const currentStop = review ? review.stops[review.index] : null;
  const current = currentStop && currentStop.palaceId === palace.id ? currentStop.objectId : null;
  return (
    <div className="scroll">
      <div className="preview">
        <span>🏛️</span>
        <I.Spark className="spark" width={16} height={16} />
      </div>
      <div className="eyebrow">Witaj w swoim pałacu</div>
      <div className="headline big">Każde miejsce opowiada historię.</div>
      <p className="lead">Stwórz świat, w którym Twoje myśli poczują się jak w domu.</p>
      <div className="steps">
        <Step n="01" t="Zbuduj przestrzeń" d="Wybierz element z biblioteki i postaw go na mapie." />
        <Step n="02" t="Dodaj znaczenie" d="Kliknij obiekt i przypisz mu wspomnienie." />
        <Step n="03" t="Wróć myślami" d="Przejdź trasę i przypomnij sobie to, co ważne." />
      </div>
      <div className="section">
        <div className="section-head">
          <div className="eyebrow">Twoja ścieżka pamięci</div>
          <span className="count">{path.length}</span>
        </div>
        {path.length === 0 && <div className="empty">Dodaj notatkę do obiektu, a pojawi się na ścieżce.</div>}
        {path.map((o, i) => (
          <div key={o.id} className={'path-row' + (o.id === current ? ' current' : '')}>
            <span className="n">{String(i + 1).padStart(2, '0')}</span>
            <button className="name" style={{ textAlign: 'left' }} onClick={() => (review ? flyTo(o.id) : select(o.id))} onDoubleClick={() => flyTo(o.id)}>
              {o.name}
            </button>
            {isDue(o.note?.srs) && <span className="due">do powtórki</span>}
            <button className="mv" title="W górę" onClick={() => movePath(o.id, -1)} disabled={i === 0}>
              <I.Up width={12} height={12} />
            </button>
            <button className="mv" title="W dół" onClick={() => movePath(o.id, 1)} disabled={i === path.length - 1}>
              <I.Down width={12} height={12} />
            </button>
            <button className="mv" style={{ opacity: 1 }} title="Przejdź do obiektu" onClick={() => flyTo(o.id)}>
              <I.Chevron width={12} height={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="quote">
        <span>
          „Pamięć potrzebuje miejsca.
          <br />
          Wyobraźnia robi resztę.”
        </span>
        <I.Leaf className="leaf" width={18} height={18} />
      </div>
    </div>
  );
}

/** Skalowanie osobno na osiach, domyślnie z zachowaniem proporcji. */
function ScaleField({ id, scale, max }: { id: string; scale: Vec3; max: number }) {
  const updateObject = useStore((s) => s.updateObject);
  const pushUndo = useStore((s) => s.pushUndo);
  const [lock, setLock] = usePref('scaleLock', true);
  const AXES: { i: 0 | 1 | 2; label: string }[] = [
    { i: 0, label: 'X — szerokość' },
    { i: 1, label: 'Y — wysokość' },
    { i: 2, label: 'Z — głębokość' },
  ];
  const apply = (axis: 0 | 1 | 2, raw: number) => {
    const v = Math.min(max, Math.max(0.1, Number.isFinite(raw) ? raw : 1));
    let next: Vec3;
    if (lock) {
      const f = v / Math.max(scale[axis], 0.001);
      next = [scale[0] * f, scale[1] * f, scale[2] * f].map((n) => Math.min(max, Math.max(0.1, n))) as Vec3;
    } else {
      next = [...scale] as Vec3;
      next[axis] = v;
    }
    updateObject(id, { scale: next }, { undo: false });
  };
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label style={{ margin: 0 }}>Wielkość</label>
        <button className={'chipy' + (lock ? ' on' : '')} onClick={() => setLock(!lock)} title="Zmieniaj wszystkie osie razem">
          {lock ? '🔒 proporcje' : '🔓 osobno'}
        </button>
      </div>
      {AXES.map(({ i, label }) => (
        <div className="row scale-row" key={i}>
          <span className="ax">{label[0]}</span>
          <input
            type="range"
            min={0.1}
            max={max}
            step={0.01}
            value={scale[i]}
            title={label}
            onPointerDown={() => pushUndo()}
            onChange={(e) => apply(i, Number(e.target.value))}
          />
          <input
            className="num"
            type="number"
            min={0.1}
            max={max}
            step={0.1}
            value={Number(scale[i].toFixed(2))}
            onChange={(e) => apply(i, Number(e.target.value))}
          />
          <button className="step" onClick={() => { pushUndo(); apply(i, scale[i] - 0.1); }} title="Zmniejsz">−</button>
          <button className="step" onClick={() => { pushUndo(); apply(i, scale[i] + 0.1); }} title="Powiększ">+</button>
        </div>
      ))}
    </div>
  );
}

function Step({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="step">
      <span className="n">{n}</span>
      <div>
        <div className="t">{t}</div>
        <div className="d">{d}</div>
      </div>
    </div>
  );
}

function Inspector({ id }: { id: string }) {
  const palace = useCurrentPalace();
  const obj = palace.objects.find((o) => o.id === id)!;
  const item = catalogItem(obj.type);
  const updateObject = useStore((s) => s.updateObject);
  const setNote = useStore((s) => s.setNote);
  const clearNote = useStore((s) => s.clearNote);
  const togglePath = useStore((s) => s.togglePath);
  const removeObject = useStore((s) => s.removeObject);
  const duplicateObject = useStore((s) => s.duplicateObject);
  const select = useStore((s) => s.select);
  const flyTo = useStore((s) => s.flyTo);
  const enterInterior = useStore((s) => s.enterInterior);
  const palaces = useStore((s) => s.data.palaces);
  const interior = obj.interiorId ? palaces.find((p) => p.id === obj.interiorId) : undefined;
  const interiorNotes = interior?.objects.filter((o) => o.note).length ?? 0;
  const dropToGround = useStore((s) => s.dropToGround);
  const pushUndo = useStore((s) => s.pushUndo);
  const anchor = obj.anchorId ? palace.objects.find((o) => o.id === obj.anchorId) : undefined;
  const stacked = palace.objects.filter((o) => o.anchorId === id).length;
  const [title, setTitle] = useState(obj.note?.title ?? '');
  const [body, setBody] = useState(obj.note?.body ?? '');
  const [name, setName] = useState(obj.name);

  // zapis notatki z opóźnieniem
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = obj.note;
      const changed = title !== (cur?.title ?? '') || body !== (cur?.body ?? '');
      if (!changed) return;
      if (!title.trim() && !body.trim()) {
        if (cur) clearNote(id);
        return;
      }
      setNote(id, title, body);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body]);

  useEffect(() => {
    if (name === obj.name) return;
    const t = setTimeout(() => updateObject(id, { name: name.trim() || item.name }, { undo: false }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const onPath = palace.path.includes(id);
  const idx = palace.path.indexOf(id);

  return (
    <div className="scroll inspector">
      <button className="back-link" onClick={() => select(null)}>
        <I.Back width={12} height={12} /> Wróć do przeglądu
      </button>
      <div className="top">
        <span className="big-ico">{item.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="type">{item.name}</div>
          <input className="palace-name" style={{ width: '100%', fontSize: 17 }} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nazwa obiektu" />
        </div>
      </div>
      {hasInterior(obj.type) && (
        <button className="btn primary" style={{ justifyContent: 'center' }} onClick={() => enterInterior(id)}>
          <I.Door width={15} height={15} /> Wejdź do środka
          {interior && (
            <span style={{ opacity: 0.75, fontSize: 12 }}>
              · {interior.objects.length} obiektów{interiorNotes > 0 ? `, ${interiorNotes} notatek` : ''}
            </span>
          )}
        </button>
      )}
      <div className="eyebrow">Wspomnienie</div>
      <div className="field">
        <label>Tytuł</label>
        <input type="text" placeholder="Np. Trzy zasady dobrego dnia" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>Treść</label>
        <textarea placeholder="Co chcesz tu zapamiętać? Obraz, historia, lista…" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {obj.note && (
        <div className="note-card">
          <div className="k">
            <span>Powtórki</span>
            <b>{obj.note.srs.reps}</b>
          </div>
          <div className="k">
            <span>Następna</span>
            <b style={{ color: isDue(obj.note.srs) ? 'var(--orange)' : undefined }}>{describeDue(obj.note.srs)}</b>
          </div>
          <div className="k">
            <span>Interwał</span>
            <b>{obj.note.srs.interval} dni</b>
          </div>
        </div>
      )}
      <button className={'switch' + (onPath ? ' on' : '')} onClick={() => togglePath(id)} disabled={!obj.note}>
        <span>{onPath ? `Na ścieżce pamięci (przystanek ${idx + 1})` : 'Dodaj do ścieżki pamięci'}</span>
        <span className="sw" />
      </button>
      {anchor && (
        <div className="anchor-row">
          <span>
            Stoi na: <b>{anchor.name}</b>
          </span>
          <button className="btn small" onClick={() => dropToGround(id)}>
            Postaw na ziemi
          </button>
        </div>
      )}
      <div className="field">
        <label>Wysokość</label>
        <div className="row">
          <input
            type="range"
            min={0}
            max={12}
            step={0.05}
            value={obj.position[1]}
            onPointerDown={() => pushUndo()}
            onChange={(e) => updateObject(id, { position: [obj.position[0], Number(e.target.value), obj.position[2]] }, { undo: false })}
          />
          <span className="val">{obj.position[1].toFixed(2)} m</span>
        </div>
      </div>
      <ScaleField id={id} scale={obj.scale} max={item.maxScale ?? 10} />
      <div className="field">
        <label>Obrót</label>
        <div className="row">
          <input type="range" min={-180} max={180} step={5} value={Math.round((obj.rotationY * 180) / Math.PI)} onChange={(e) => updateObject(id, { rotationY: (Number(e.target.value) * Math.PI) / 180 }, { undo: false })} />
          <span className="val">{Math.round((obj.rotationY * 180) / Math.PI)}°</span>
        </div>
      </div>
      <div className="actions">
        <button className="btn small" onClick={() => flyTo(id)}>
          <I.Eye width={14} height={14} /> Pokaż
        </button>
        <button className="btn small" onClick={() => duplicateObject(id)}>
          <I.Copy width={14} height={14} /> Duplikuj
        </button>
        {obj.note && (
          <button className="btn small" onClick={() => { setTitle(''); setBody(''); clearNote(id); }}>
            Usuń notatkę
          </button>
        )}
        <button
          className="btn small danger"
          onClick={() => {
            if (interior && interior.objects.length > 0 && !confirm(`Budynek ma wnętrze z ${interior.objects.length} obiektami. Usunąć razem z wnętrzem?`)) return;
            if (stacked > 0 && !confirm(`Na tym obiekcie stoi ${stacked} ${stacked === 1 ? 'obiekt' : 'obiekty'} — opadną na ziemię. Usunąć?`)) return;
            removeObject(id);
          }}
        >
          <I.Trash width={14} height={14} /> Usuń obiekt
        </button>
      </div>
    </div>
  );
}
