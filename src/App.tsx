import { useEffect, useState } from 'react';
import { PhoneBar, SubBar, TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { Viewport } from './components/Viewport';
import { HelpModal } from './components/HelpModal';
import { useStore } from './store';
import { LANDSCAPE_Q, PHONE_Q, useMediaQuery } from './lib/media';
import { I } from './components/Icons';

export default function App() {
  const [help, setHelp] = useState(false);
  const [mobile, setMobile] = useState<'left' | 'right' | null>(null);
  const [menu, setMenu] = useState(false);
  const toast = useStore((s) => s.toast);
  const selectedId = useStore((s) => s.selectedIds[0] ?? null);
  const vrActive = useStore((s) => s.vrActive);
  const viewMode = useStore((s) => s.viewMode);
  const landscape = useMediaQuery(LANDSCAPE_Q);
  const phone = useMediaQuery(PHONE_Q) || landscape;

  // na telefonie: wybór obiektu otwiera panel z notatką (w spacerze nie — zasłaniałby widok)
  useEffect(() => {
    if (selectedId && phone && viewMode === 'editor') setMobile('right');
  }, [selectedId, phone, viewMode]);
  // wejście w spacer chowa szuflady i menu, żeby nic nie zasłaniało sceny
  useEffect(() => {
    if (viewMode !== 'editor') {
      setMobile(null);
      setMenu(false);
    }
  }, [viewMode]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      const typing = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        (document.querySelector('.search input') as HTMLInputElement | null)?.focus();
      }
      if (e.key === '?' && !typing) setHelp((h) => !h);
      if (e.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const toggleDrawer = (side: 'left' | 'right') => setMobile((m) => (m === side ? null : side));
  const hudHidden = vrActive;

  return (
    <div className={'app' + (phone ? ' phone' : '') + (landscape ? ' landscape' : '')}>
      {!phone && <TopBar onHelp={() => setHelp(true)} />}
      {!phone && <SubBar />}
      {phone && !landscape && <PhoneBar onMenu={() => setMenu(true)} />}
      <main
        className="main"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.viewport')) setMobile(null);
        }}
      >
        <LeftPanelWrap open={mobile === 'left'} />
        <Viewport />
        <RightPanelWrap open={mobile === 'right'} />
        {landscape && !hudHidden && (
          <button className="land-menu" onClick={() => setMenu(true)} title="Menu pałacu" aria-label="Menu">
            <I.Menu />
          </button>
        )}
        {landscape && !hudHidden && viewMode === 'editor' && (
          <nav className="land-rail" aria-label="Panele">
            <button className={mobile === 'left' ? 'active' : ''} onClick={() => toggleDrawer('left')} title="Biblioteka">
              <I.Library />
            </button>
            <button className={mobile === 'right' ? 'active' : ''} onClick={() => toggleDrawer('right')} title={selectedId ? 'Notatka' : 'Ścieżka'}>
              {selectedId ? <I.Note /> : <I.List />}
            </button>
          </nav>
        )}
      </main>
      {phone && !landscape && !hudHidden && (
        <nav className="mobile-bar">
          <button className={mobile === 'left' ? 'active' : ''} onClick={() => toggleDrawer('left')}>
            <I.Library width={18} height={18} />
            Biblioteka
          </button>
          <button className={mobile === null ? 'active' : ''} onClick={() => setMobile(null)}>
            <I.Cube width={18} height={18} />
            Scena
          </button>
          <button className={mobile === 'right' ? 'active' : ''} onClick={() => toggleDrawer('right')}>
            {selectedId ? <I.Note width={18} height={18} /> : <I.List width={18} height={18} />}
            {selectedId ? 'Notatka' : 'Ścieżka'}
          </button>
        </nav>
      )}
      {phone && menu && (
        <div className="sheet-backdrop" onClick={() => setMenu(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <span className="eyebrow">Menu pałacu</span>
              <button className="icon-btn" onClick={() => setMenu(false)} aria-label="Zamknij">
                <I.X />
              </button>
            </div>
            <TopBar onHelp={() => { setMenu(false); setHelp(true); }} />
            <SubBar />
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {help && <HelpModal onClose={() => setHelp(false)} />}
    </div>
  );
}

function LeftPanelWrap({ open }: { open: boolean }) {
  useEffect(() => {
    document.querySelector('.panel.left')?.classList.toggle('open', open);
  }, [open]);
  return <LeftPanel />;
}
function RightPanelWrap({ open }: { open: boolean }) {
  useEffect(() => {
    document.querySelector('.panel.right')?.classList.toggle('open', open);
  }, [open]);
  return <RightPanel />;
}
