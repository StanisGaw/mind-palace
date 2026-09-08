import { useEffect, useRef, useState } from 'react';
import { useCurrentPalace, useStore, dueCount } from '../store';
import { chainOf, downloadText, exportPalaceJson, parseImport, rootOf } from '../lib/storage';
import type { Palace, RoomPreset } from '../types';
import { I } from './Icons';
import { Tip } from './Tip';

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
          <Tip label="Przełącz albo utwórz pałac" side="bottom">
            <button className="palace-switch" onClick={() => setOpen((o) => !o)}>
              <span className="dot" />
              {current?.name ?? 'Twoja prywatna przestrzeń'}
              <I.ChevronDown width={14} height={14} />
            </button>
          </Tip>
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
      <Tip label="Pomoc i skróty klawiszowe" side="bottom">
        <button className="icon-btn" onClick={onHelp}>
          <I.Help />
        </button>
      </Tip>
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
  const customPresets = useStore((s) => s.customPresets);
  const startReview = useStore((s) => s.startReview);
  const review = useStore((s) => s.review);
  const endReview = useStore((s) => s.endReview);
  const showToast = useStore((s) => s.showToast);
  const camera = useStore((s) => s.camera);
  const fileRef = useRef<HTMLInputElement>(null);
  const due = dueCount(palace, palaces);
  const [pendingImport, setPendingImport] = useState<{ palaces: Palace[]; presets: RoomPreset[] } | null>(null);

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseImport(text);
      // plik ze starym formatem (bez presetów) importujemy od razu — dialog widzą tylko pliki, które mają wybór do zrobienia
      if (parsed.presets.length > 0) {
        setPendingImport(parsed);
        return;
      }
      importPalaces(parsed.palaces);
      showToast(`Zaimportowano: ${parsed.palaces.map((p) => p.name).join(', ')}`);
    } catch (e) {
      showToast('Nie udało się zaimportować pliku: ' + (e as Error).message);
    }
  };

  return (
    <div className="subbar">
      <Tip label="Wyśrodkuj widok na scenie" keys="F" side="bottom">
        <button className="home-btn" onClick={() => camera('center')}>
          <I.Home />
        </button>
      </Tip>
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
      {!pendingImport && (
        <Tip label="Wczytaj pałac z pliku JSON" side="bottom">
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            <I.Upload /> <span className="label-text">Importuj</span>
          </button>
        </Tip>
      )}
      <Tip label="Zapisz pałac razem z wnętrzami do pliku" side="bottom">
        <button
          className="btn"
          onClick={() => {
            const root = rootOf(palace.id, palaces);
            const safe = root.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'palac';
            downloadText(`mneme-${safe}.json`, exportPalaceJson(root, palaces, customPresets));
          }}
        >
          <I.Download /> <span className="label-text">Eksportuj</span>
        </button>
      </Tip>
      {palace.interior && (
        <Tip label="Wyjdź z budynku na planszę" side="bottom">
          <button className="btn" onClick={exitInterior}>
            <I.Back /> <span className="label-text">Wyjdź na zewnątrz</span>
          </button>
        </Tip>
      )}
      {review ? (
        <Tip label="Zakończ spacer pamięci" side="bottom">
          <button className="btn danger" onClick={endReview}>
            <I.X /> <span className="label-text">Zakończ spacer</span>
          </button>
        </Tip>
      ) : (
        <Tip label="Powtórka: kamera prowadzi po przystankach ścieżki" side="bottom">
          <button className="btn primary" onClick={() => startReview(false)}>
            <I.Walk /> <span className="label-text">Spacer pamięci</span> {due > 0 && <span className="badge">{due}</span>} <I.Arrow />
          </button>
        </Tip>
      )}
      {pendingImport && <ImportDialog data={pendingImport} onClose={() => setPendingImport(null)} />}
    </div>
  );
}

/** Plik zawiera własne presety — pyta osobno o pałac (dodaj / zastąp / pomiń) i o presety (importuj / pomiń). */
/** Belka telefonu w pionie: dom, nazwa, spacer i menu z resztą działań. */
export function PhoneBar({ onMenu }: { onMenu: () => void }) {
  const palace = useCurrentPalace();
  const palaces = useStore((s) => s.data.palaces);
  const renamePalace = useStore((s) => s.renamePalace);
  const startReview = useStore((s) => s.startReview);
  const review = useStore((s) => s.review);
  const endReview = useStore((s) => s.endReview);
  const exitInterior = useStore((s) => s.exitInterior);
  const camera = useStore((s) => s.camera);
  const due = dueCount(palace, palaces);
  return (
    <div className="phone-bar">
      <button className="home-btn" onClick={() => (palace.interior ? exitInterior() : camera('center'))} title={palace.interior ? 'Wyjdź na zewnątrz' : 'Wyśrodkuj widok'}>
        {palace.interior ? <I.Back /> : <I.Home />}
      </button>
      {palace.interior ? (
        <div className="palace-name">
          {palace.name} <span className="type-tag">wnętrze</span>
        </div>
      ) : (
        <input className="palace-name" value={palace.name} onChange={(e) => renamePalace(e.target.value)} aria-label="Nazwa pałacu" />
      )}
      {review ? (
        <button className="btn danger" onClick={endReview} title="Zakończ spacer">
          <I.X />
        </button>
      ) : (
        <button className="btn primary" onClick={() => startReview(false)} title="Spacer pamięci">
          <I.Walk /> {due > 0 && <span className="badge">{due}</span>}
        </button>
      )}
      <button className="icon-btn" onClick={onMenu} aria-label="Menu">
        <I.Menu />
      </button>
    </div>
  );
}

function ImportDialog({ data, onClose }: { data: { palaces: Palace[]; presets: RoomPreset[] }; onClose: () => void }) {
  const palace = useCurrentPalace();
  const allPalaces = useStore((s) => s.data.palaces);
  const importPalaces = useStore((s) => s.importPalaces);
  const importPresets = useStore((s) => s.importPresets);
  const deletePalace = useStore((s) => s.deletePalace);
  const showToast = useStore((s) => s.showToast);
  const [palaceChoice, setPalaceChoice] = useState<'new' | 'replace' | 'skip'>('new');
  const [presetChoice, setPresetChoice] = useState<'import' | 'skip'>('import');
  const root = data.palaces.find((p) => !p.parentId) ?? data.palaces[0];

  const onConfirm = () => {
    if (palaceChoice !== 'skip') {
      if (palaceChoice === 'replace') deletePalace(rootOf(palace.id, allPalaces).id);
      importPalaces(data.palaces);
    }
    if (presetChoice === 'import' && data.presets.length > 0) importPresets(data.presets);
    showToast('Zaimportowano plik.');
    onClose();
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose} title="Zamknij">
          <I.X />
        </button>
        <h2>Import pliku</h2>
        <h3>Pałac: {root?.name ?? '—'}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label>
            <input type="radio" checked={palaceChoice === 'new'} onChange={() => setPalaceChoice('new')} /> Dodaj jako nowy
          </label>
          <label>
            <input type="radio" checked={palaceChoice === 'replace'} onChange={() => setPalaceChoice('replace')} /> Zastąp bieżący
          </label>
          <label>
            <input type="radio" checked={palaceChoice === 'skip'} onChange={() => setPalaceChoice('skip')} /> Pomiń
          </label>
        </div>
        <h3>Presety ({data.presets.length})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label>
            <input type="radio" checked={presetChoice === 'import'} onChange={() => setPresetChoice('import')} /> Dołącz
          </label>
          <label>
            <input type="radio" checked={presetChoice === 'skip'} onChange={() => setPresetChoice('skip')} /> Pomiń
          </label>
        </div>
        <button className="btn primary" onClick={onConfirm}>
          Importuj
        </button>
      </div>
    </div>
  );
}
