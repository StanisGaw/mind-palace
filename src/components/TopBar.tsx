import { useEffect, useRef, useState } from 'react';
import { useCurrentPalace, useStore, dueCount } from '../store';
import { chainOf, downloadText, exportPalaceJson, parseImport, rootOf } from '../lib/storage';
import { I } from './Icons';

export function TopBar({ onHelp }: { onHelp: () => void }) {
  const allPalaces = useStore((s) => s.data.palaces);
  const palaces = allPalaces.filter((p) => !p.parentId);
  const currentId = useStore((s) => s.data.currentId);
  const currentRootId = rootOf(currentId, allPalaces).id;
  const switchPalace = useStore((s) => s.switchPalace);
  const createPalace = useStore((s) => s.createPalace);
  const deletePalace = useStore((s) => s.deletePalace);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = allPalaces.find((p) => p.id === currentId);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <header className="topbar">
      <div className="logo">
        <span className="mark">m</span>
        <span>
          mneme<span className="dot">.</span>
        </span>
      </div>
      <span className="tagline">miejsce dla myśli</span>
      <div className="center">
        <div ref={ref} style={{ position: 'relative' }}>
          <button className="palace-switch" onClick={() => setOpen((o) => !o)} title="Przełącz pałac">
            <span className="dot" />
            {current?.name ?? 'Twoja prywatna przestrzeń'}
            <I.ChevronDown width={14} height={14} />
          </button>
          {open && (
            <div className="menu">
              {palaces.map((p) => (
                <div key={p.id} className={'item' + (p.id === currentRootId ? ' active' : '')}>
                  <button
                    style={{ flex: 1, textAlign: 'left' }}
                    onClick={() => {
                      switchPalace(p.id);
                      setOpen(false);
                    }}
                  >
                    {p.name}
                    <span style={{ color: 'var(--muted-2)', fontSize: 11, marginLeft: 8 }}>{p.objects.length} obiektów</span>
                  </button>
                  <button
                    className="del"
                    title="Usuń pałac"
                    onClick={() => {
                      if (confirm(`Usunąć pałac „${p.name}”? Tej operacji nie można cofnąć.`)) deletePalace(p.id);
                    }}
                  >
                    usuń
                  </button>
                </div>
              ))}
              <div className="sep" />
              <button
                className="item"
                onClick={() => {
                  const name = prompt('Nazwa nowego pałacu', 'Nowy pałac');
                  if (name !== null) createPalace(name.trim() || undefined);
                  setOpen(false);
                }}
              >
                <span>
                  <I.Plus width={12} height={12} /> Nowy pałac
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
      <button className="icon-btn" onClick={onHelp} title="Pomoc i skróty">
        <I.Help />
      </button>
      <div className="avatar">JA</div>
    </header>
  );
}

export function SubBar() {
  const palace = useCurrentPalace();
  const palaces = useStore((s) => s.data.palaces);
  const currentId = useStore((s) => s.data.currentId);
  const switchPalace = useStore((s) => s.switchPalace);
  const exitInterior = useStore((s) => s.exitInterior);
  const trail = chainOf(currentId, palaces);
  const saved = useStore((s) => s.saved);
  const renamePalace = useStore((s) => s.renamePalace);
  const importPalaces = useStore((s) => s.importPalaces);
  const startReview = useStore((s) => s.startReview);
  const review = useStore((s) => s.review);
  const endReview = useStore((s) => s.endReview);
  const showToast = useStore((s) => s.showToast);
  const camera = useStore((s) => s.camera);
  const fileRef = useRef<HTMLInputElement>(null);
  const due = dueCount(palace, palaces);

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const palaces = parseImport(text);
      importPalaces(palaces);
      showToast(`Zaimportowano: ${palaces.map((p) => p.name).join(', ')}`);
    } catch (e) {
      showToast('Nie udało się zaimportować pliku: ' + (e as Error).message);
    }
  };

  return (
    <div className="subbar">
      <button className="home-btn" title="Wyśrodkuj widok na scenie" onClick={() => camera('center')}>
        <I.Home />
      </button>
      <div>
        <div className="crumbs">
          <span>Moje pałace</span>
          {trail.map((p) => (
            <span key={p.id} style={{ display: 'contents' }}>
              <span className="sep">›</span>
              {p.id === palace.id ? <span>{p.name}</span> : <button onClick={() => switchPalace(p.id)}>{p.name}</button>}
            </span>
          ))}
        </div>
        {palace.interior ? (
          <div className="palace-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {palace.name}
            <span className="type-tag">wnętrze</span>
          </div>
        ) : (
          <input className="palace-name" value={palace.name} onChange={(e) => renamePalace(e.target.value)} aria-label="Nazwa pałacu" />
        )}
      </div>
      <div className={'saved' + (saved ? '' : ' pending')}>
        <I.Check className="tick" width={14} height={14} />
        {saved ? 'Zapisano lokalnie' : 'Zapisywanie…'}
      </div>
      <div className="spacer" />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = '';
        }}
      />
      <button className="btn ghost" onClick={() => fileRef.current?.click()}>
        <I.Upload /> <span className="label-text">Importuj</span>
      </button>
      <button
        className="btn"
        title="Zapisz pałac razem z wnętrzami do pliku"
        onClick={() => {
          const root = rootOf(palace.id, palaces);
          const safe = root.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'palac';
          downloadText(`mneme-${safe}.json`, exportPalaceJson(root, palaces));
        }}
      >
        <I.Download /> <span className="label-text">Eksportuj</span>
      </button>
      {palace.interior && (
        <button className="btn" onClick={exitInterior} title="Wyjdź z budynku">
          <I.Back /> <span className="label-text">Wyjdź na zewnątrz</span>
        </button>
      )}
      {review ? (
        <button className="btn danger" onClick={endReview}>
          <I.X /> <span className="label-text">Zakończ spacer</span>
        </button>
      ) : (
        <button className="btn primary" onClick={() => startReview(false)}>
          <I.Walk /> <span className="label-text">Spacer pamięci</span> {due > 0 && <span className="badge">{due}</span>} <I.Arrow />
        </button>
      )}
    </div>
  );
}
