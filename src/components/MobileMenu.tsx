import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useCurrentPalace, useStore, dueCount } from '../store';
import { downloadText, exportPalaceJson, rootOf } from '../lib/storage';
import { ImportDialog, useImportFile } from './TopBar';
import { NewPalaceDialog } from './NewPalaceDialog';
import { I } from './Icons';

/** Menu pałacu na telefonie: nazwa, główne działania i lista pałaców w jednym arkuszu. */
export function MobileMenu({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const palace = useCurrentPalace();
  const allPalaces = useStore((s) => s.data.palaces);
  const roots = allPalaces.filter((p) => !p.parentId);
  const currentRootId = rootOf(palace.id, allPalaces).id;
  const saved = useStore((s) => s.saved);
  const renamePalace = useStore((s) => s.renamePalace);
  const switchPalace = useStore((s) => s.switchPalace);
  const deletePalace = useStore((s) => s.deletePalace);
  const exitInterior = useStore((s) => s.exitInterior);
  const camera = useStore((s) => s.camera);
  const startReview = useStore((s) => s.startReview);
  const endReview = useStore((s) => s.endReview);
  const review = useStore((s) => s.review);
  const customSets = useStore((s) => s.customSets);
  const due = dueCount(palace, allPalaces);
  const fileRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const { onImport, pendingImport, setPendingImport } = useImportFile();

  const Row = ({ icon, label, hint, onClick, kind }: { icon: ReactNode; label: string; hint?: ReactNode; onClick: () => void; kind?: 'primary' | 'danger' }) => (
    <button className={'mmenu-row' + (kind ? ` ${kind}` : '')} onClick={onClick}>
      <span className="ico">{icon}</span>
      <span className="grow">{label}</span>
      {hint}
      <I.Chevron className="chev" width={14} height={14} />
    </button>
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mmenu" onClick={(e) => e.stopPropagation()}>
        <div className="mmenu-grip" />
        <div className="mmenu-head">
          <span className="mark">m</span>
          <div className="mmenu-title">
            {palace.interior ? (
              <div className="mmenu-name">
                {palace.name} <span className="type-tag">wnętrze</span>
              </div>
            ) : (
              <input className="mmenu-name" value={palace.name} onChange={(e) => renamePalace(e.target.value)} aria-label="Nazwa pałacu" />
            )}
            <div className="mmenu-sub">
              {palace.objects.length} obiektów · {saved ? 'zapisano lokalnie' : 'zapisywanie…'}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij">
            <I.X />
          </button>
        </div>
        <div className="mmenu-list">
          {review ? (
            <Row kind="danger" icon={<I.X />} label="Zakończ spacer" onClick={() => { endReview(); onClose(); }} />
          ) : (
            <Row kind="primary" icon={<I.Walk />} label="Spacer pamięci" hint={due > 0 ? <span className="badge">{due}</span> : undefined} onClick={() => { startReview(false); onClose(); }} />
          )}
          {palace.interior ? (
            <Row icon={<I.Back />} label="Wyjdź na zewnątrz" onClick={() => { exitInterior(); onClose(); }} />
          ) : (
            <Row icon={<I.Center />} label="Wyśrodkuj widok" onClick={() => { camera('center'); onClose(); }} />
          )}
          <Row icon={<I.Upload />} label="Importuj pałac z pliku" onClick={() => fileRef.current?.click()} />
          <Row
            icon={<I.Download />}
            label="Eksportuj do pliku"
            onClick={() => {
              const root = rootOf(palace.id, allPalaces);
              const safe = root.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'palac';
              downloadText(`mneme-${safe}.json`, exportPalaceJson(root, allPalaces, customSets));
              onClose();
            }}
          />
          <Row icon={<I.Help />} label="Pomoc i sterowanie" onClick={onHelp} />
        </div>
        <div className="mmenu-section">Twoje pałace</div>
        <div className="mmenu-list">
          {roots.map((p) => (
            <div key={p.id} className={'mmenu-row' + (p.id === currentRootId ? ' active' : '')}>
              <button
                className="grow"
                onClick={() => {
                  switchPalace(p.id);
                  onClose();
                }}
              >
                {p.name}
                <span className="meta">{p.objects.length} obiektów</span>
              </button>
              {roots.length > 1 && (
                <button
                  className="del"
                  onClick={() => {
                    if (confirm(`Usunąć pałac „${p.name}”? Tej operacji nie można cofnąć.`)) deletePalace(p.id);
                  }}
                >
                  usuń
                </button>
              )}
            </div>
          ))}
          <Row icon={<I.Plus />} label="Nowy pałac" onClick={() => setCreating(true)} />
        </div>
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
        {pendingImport && <ImportDialog data={pendingImport} onClose={() => { setPendingImport(null); onClose(); }} />}
        {creating && <NewPalaceDialog onClose={() => { setCreating(false); onClose(); }} />}
      </div>
    </div>
  );
}
