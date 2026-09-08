import { useEffect, useState } from 'react';
import { SubBar, TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { Viewport } from './components/Viewport';
import { HelpModal } from './components/HelpModal';
import { useStore } from './store';

export default function App() {
  const [help, setHelp] = useState(false);
  const [mobile, setMobile] = useState<'left' | 'right' | null>(null);
  const toast = useStore((s) => s.toast);
  const selectedId = useStore((s) => s.selectedIds[0] ?? null);
  const vrActive = useStore((s) => s.vrActive);

  // na telefonie: wybór obiektu otwiera panel z notatką
  useEffect(() => {
    if (selectedId && matchMedia('(max-width: 900px)').matches) setMobile('right');
  }, [selectedId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      const typing = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        (document.querySelector('.search input') as HTMLInputElement | null)?.focus();
      }
      if (e.key === '?' && !typing) setHelp((h) => !h);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="app">
      <TopBar onHelp={() => setHelp(true)} />
      <SubBar />
      <main className="main" onClick={(e) => { if ((e.target as HTMLElement).closest('.viewport')) setMobile(null); }}>
        <LeftPanelWrap open={mobile === 'left'} />
        <Viewport />
        <RightPanelWrap open={mobile === 'right'} />
      </main>
      {!vrActive && (
        <nav className="mobile-bar">
          <button className={mobile === 'left' ? 'active' : ''} onClick={() => setMobile((m) => (m === 'left' ? null : 'left'))}>Biblioteka</button>
          <button className={mobile === null ? 'active' : ''} onClick={() => setMobile(null)}>Scena</button>
          <button className={mobile === 'right' ? 'active' : ''} onClick={() => setMobile((m) => (m === 'right' ? null : 'right'))}>{selectedId ? 'Notatka' : 'Ścieżka'}</button>
        </nav>
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
