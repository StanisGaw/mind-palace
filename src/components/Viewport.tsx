import { useEffect, useRef, useState } from 'react';
import { AMBIENCES, SCENERIES, WEATHERS } from '../catalog';
import { GROUND_SHAPES } from '../lib/ground';
import { BUILTIN_TEXTURES, textureThumb } from '../three/textures';
import { addCustomTexture, loadCustomTextures, removeCustomTexture, type CustomTexture } from '../lib/textureStore';
import { allLandscapes, removeLandscape, saveLandscape, type LandscapePreset } from '../lib/landscapes';
import type { Scenery, Weather } from '../types';
import { useCurrentPalace, useStore } from '../store';
import { SceneManager } from '../three/SceneManager';
import { I } from './Icons';
import { ReviewOverlay } from './ReviewOverlay';

export function Viewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mgrRef = useRef<SceneManager | null>(null);
  const [ready, setReady] = useState(false);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const camera = useStore((s) => s.camera);
  const review = useStore((s) => s.review);
  const vrActive = useStore((s) => s.vrActive);
  const topView = useStore((s) => s.topView);
  const doorPrompt = useStore((s) => s.doorPrompt);
  const setSettings = useStore((s) => s.setSettings);
  const palace = useCurrentPalace();
  const isTouch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  useEffect(() => {
    if (!hostRef.current) return;
    const mgr = new SceneManager(hostRef.current);
    mgrRef.current = mgr;
    if (import.meta.env.DEV) (window as unknown as { __scene?: SceneManager }).__scene = mgr;
    setReady(true);
    return () => {
      mgr.dispose();
      mgrRef.current = null;
    };
  }, []);

  // iPhone nie udostępnia pełnego ekranu dla elementów — wtedy widok rozciągamy stylami
  const nativeFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;

  const enterFullscreen = () => {
    const el = wrapRef.current;
    if (!el || !nativeFullscreen || document.fullscreenElement) return;
    el.requestFullscreen?.().catch(() => undefined);
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const modeChip = viewMode === 'editor' ? 'Tryb tworzenia' : viewMode === 'fp' ? 'Widok z oczu' : 'Wirtualna rzeczywistość';

  return (
    <section
      ref={wrapRef}
      className={
        'viewport' +
        (vrActive ? ' vr-active' : '') +
        (vrActive && !nativeFullscreen ? ' vr-cover' : '') +
        (viewMode === 'fp' ? ' fp-mode' : '')
      }
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

      {/* góra-lewo: tryb */}
      <div className="hud hud-top-left" style={{ top: 16, left: 16, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={'chip' + (review ? ' warm' : '')}>
          <span className="dot" /> {review ? 'Spacer pamięci' : modeChip}
        </span>
        <div className="segmented">
          <button className={viewMode === 'editor' ? 'active' : ''} onClick={() => setViewMode('editor')} title="Edytor (widok z góry)">
            <I.Cube width={13} height={13} style={{ verticalAlign: -2, marginRight: 5 }} />
            Edytor
          </button>
          <button className={viewMode === 'fp' ? 'active' : ''} onClick={() => setViewMode('fp')} title="Spacer w pierwszej osobie">
            <I.Eye width={13} height={13} style={{ verticalAlign: -2, marginRight: 5 }} />Z oczu
          </button>
          <button
            className={viewMode === 'vr' ? 'active' : ''}
            onClick={() => {
              // pełny ekran trzeba poprosić w samym dotknięciu — po pierwszym await
              // (sprawdzenie WebXR, zgoda na czujniki) przeglądarka już odmawia
              enterFullscreen();
              setViewMode('vr');
            }}
            title="VR (gogle lub telefon w Cardboard)"
          >
            <I.Vr width={13} height={13} style={{ verticalAlign: -2, marginRight: 5 }} />
            VR
          </button>
        </div>
      </div>

      {/* góra-prawo: otoczenie */}
      <div className="hud hud-top-right" style={{ top: 16, right: 16 }}>
        <EnvironmentMenu />
      </div>

      {/* narzędzia */}
      {viewMode === 'editor' && (
        <div className="hud tools" style={{ top: 70, left: 16 }}>
          <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Zaznacz obiekt (V)">
            <I.Cursor />
          </button>
          <button className={tool === 'move' ? 'active' : ''} onClick={() => setTool('move')} title="Przesuń — uchwyt ze strzałkami (M)">
            <I.Move />
          </button>
          <button className={tool === 'rotate' ? 'active' : ''} onClick={() => setTool('rotate')} title="Obróć — pierścień (R)">
            <I.Rotate />
          </button>
          <div className="sep" />
          <button onClick={undo} disabled={!canUndo} title="Cofnij (Ctrl+Z)">
            <I.Undo />
          </button>
          <button onClick={redo} disabled={!canRedo} title="Ponów (Ctrl+Shift+Z)">
            <I.Redo />
          </button>
        </div>
      )}

      {viewMode === 'editor' && (
        <div className="hud compass" style={{ top: 64, right: 16 }} title="Północ">
          <svg width="26" height="26" viewBox="0 0 24 24">
            <path d="M12 3l4 9h-8z" fill="var(--accent)" />
            <path d="M12 21l-4-9h8z" fill="var(--border-2)" />
          </svg>
          N
        </div>
      )}

      {/* dół-prawo: kamera */}
      <div className="hud tools" style={{ bottom: 64, right: 16 }}>
        <button onClick={() => camera('zoomIn')} title="Przybliż" disabled={viewMode !== 'editor'}>
          <I.Plus />
        </button>
        <button onClick={() => camera('zoomOut')} title="Oddal" disabled={viewMode !== 'editor'}>
          <I.Minus />
        </button>
        <div className="sep" />
        <button onClick={() => camera('center')} title="Wyśrodkuj — domyślny rzut (F)">
          <I.Center />
        </button>
        <button className={topView ? 'active' : ''} onClick={() => camera('topView')} title="Widok z góry na całą planszę (T)" disabled={viewMode !== 'editor'}>
          <I.TopView />
        </button>
        <button onClick={toggleFullscreen} title="Pełny ekran">
          <I.Fullscreen />
        </button>
      </div>

      {/* dół: podpowiedzi i przełączniki */}
      <div className="hud hint" style={{ bottom: 16, left: 16 }}>
        {viewMode === 'editor' ? (
          <>
            <span>
              <I.Cursor width={12} height={12} /> Przeciągnij, aby obracać
            </span>
            <span>Scroll, aby przybliżać</span>
            <span>Prawy przycisk: przesuń widok</span>
            <span>Del: usuń obiekt</span>
          </>
        ) : viewMode === 'fp' ? (
          <span>
            <I.Eye width={12} height={12} /> WASD — chodzenie · Spacja — skok · F — drzwi · Esc — kursor
          </span>
        ) : null}
      </div>
      <div className="hud toggles" style={{ bottom: 16, right: 16 }}>
        <button className={'toggle' + (palace.settings.grid ? ' on' : '')} onClick={() => setSettings({ grid: !palace.settings.grid })}>
          <I.Grid width={13} height={13} /> Siatka
        </button>
        <button className={'toggle' + (palace.settings.showPath ? ' on' : '')} onClick={() => setSettings({ showPath: !palace.settings.showPath })}>
          <I.Path width={13} height={13} /> Ścieżka
        </button>
      </div>

      {viewMode !== 'editor' && !vrActive && doorPrompt && (
        <button
          className="door-prompt"
          onClick={() => mgrRef.current?.useDoor()}
        >
          <I.Door width={15} height={15} /> {doorPrompt.label} <kbd>F</kbd>
        </button>
      )}

      {viewMode === 'fp' && !vrActive && (
        <>
          <div className="crosshair" />
          {!isTouch && <FpLockHint />}
          {isTouch && <Joystick onChange={(x, y) => { if (mgrRef.current) mgrRef.current.joystick = { x, y }; }} />}
          {isTouch && (
            <button
              className="jump-btn"
              onPointerDown={(e) => {
                e.stopPropagation();
                mgrRef.current?.jump();
              }}
            >
              Skok
            </button>
          )}
        </>
      )}

      {vrActive && (
        <>
          <button className="vr-exit" onClick={() => setViewMode('fp')}>
            Wyjdź z VR
          </button>
          <div className="vr-hint">
            Rozglądanie: ruch myszą albo przeciągnięcie palcem. Marsz: przytrzymaj przycisk albo <kbd>W</kbd>{' '}
            <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>. Krótkie kliknięcie: interakcja.
          </div>
        </>
      )}

      {review && !vrActive && <ReviewOverlay />}
      {!ready && null}
    </section>
  );
}

/** Klimat, pogoda i sceneria w jednym rozwijanym panelu (trzy selecty nie mieszczą się na telefonie). */
function EnvironmentMenu() {
  const palace = useCurrentPalace();
  const setSettings = useStore((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  const s = palace.settings;
  const ambName = AMBIENCES.find((a) => a.id === s.ambience)?.name ?? s.ambience;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="toggle" onClick={() => setOpen((o) => !o)} title="Otoczenie: klimat, pogoda, krajobraz">
        <I.Leaf width={13} height={13} /> {ambName}
        <I.ChevronDown width={12} height={12} />
      </button>
      {open && (
        <div className="env-menu">
          <label>
            <span>Klimat</span>
            <select value={s.ambience} onChange={(e) => setSettings({ ambience: e.target.value })}>
              {AMBIENCES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Pogoda</span>
            <select value={s.weather} onChange={(e) => setSettings({ weather: e.target.value as Weather })}>
              {WEATHERS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Krajobraz</span>
            <select value={s.scenery} onChange={(e) => setSettings({ scenery: e.target.value as Scenery })}>
              {SCENERIES.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn small" onClick={() => setSettings({ seed: (Math.random() * 1e9) | 0 })} disabled={s.scenery === 'none'}>
            <I.Spark width={13} height={13} /> Losuj ukształtowanie terenu
          </button>
          {!palace.interior && <GroundSection />}
          <TextureSection />
          {!palace.interior && <LandscapeSection />}
        </div>
      )}
    </div>
  );
}

/** Kształt i wymiary płyty, po której się chodzi. */
function GroundSection() {
  const palace = useCurrentPalace();
  const setSettings = useStore((s) => s.setSettings);
  const g = palace.settings.ground;
  const round = g.shape !== 'rect';
  const set = (patch: Partial<typeof g>) => setSettings({ ground: { ...g, ...patch } });
  return (
    <div className="env-section">
      <span className="env-title">Plansza</span>
      <div className="shape-row">
        {GROUND_SHAPES.map((sh) => (
          <button key={sh.id} className={'shape-btn' + (g.shape === sh.id ? ' on' : '')} onClick={() => set({ shape: sh.id })}>
            {sh.name}
          </button>
        ))}
      </div>
      <label>
        <span>{round ? 'Średnica' : 'Szerokość'}: {g.width} m</span>
        <input
          type="range"
          min={10}
          max={80}
          step={2}
          value={g.width}
          onChange={(e) => set(round ? { width: Number(e.target.value), depth: Number(e.target.value) } : { width: Number(e.target.value) })}
        />
      </label>
      {!round && (
        <label>
          <span>Głębokość: {g.depth} m</span>
          <input type="range" min={10} max={80} step={2} value={g.depth} onChange={(e) => set({ depth: Number(e.target.value) })} />
        </label>
      )}
    </div>
  );
}

/** Wybór tekstury podłoża: wbudowane wzory i własne obrazy. */
function TextureSection() {
  const palace = useCurrentPalace();
  const setSettings = useStore((s) => s.setSettings);
  const showToast = useStore((s) => s.showToast);
  const [custom, setCustom] = useState<CustomTexture[]>(() => loadCustomTextures());
  const fileRef = useRef<HTMLInputElement>(null);
  const cur = palace.settings.groundTexture;
  const onFile = async (f: File) => {
    try {
      const t = await addCustomTexture(f);
      setCustom(loadCustomTextures());
      setSettings({ groundTexture: t.id });
    } catch (e) {
      showToast((e as Error).message);
    }
  };
  return (
    <div className="env-section">
      <span className="env-title">{palace.interior ? 'Podłoga' : 'Nawierzchnia'}</span>
      <div className="tex-grid">
        <button className={'tex-tile none' + (!cur ? ' on' : '')} onClick={() => setSettings({ groundTexture: undefined })} title="Bez tekstury">
          —
        </button>
        {BUILTIN_TEXTURES.map((t) => (
          <button
            key={t.id}
            className={'tex-tile' + (cur === t.id ? ' on' : '')}
            style={{ backgroundImage: `url(${textureThumb(t.id)})` }}
            title={t.name}
            onClick={() => setSettings({ groundTexture: t.id })}
          />
        ))}
        {custom.map((t) => (
          <span key={t.id} className="tex-wrap">
            <button
              className={'tex-tile' + (cur === t.id ? ' on' : '')}
              style={{ backgroundImage: `url(${t.dataUrl})` }}
              title={t.name}
              onClick={() => setSettings({ groundTexture: t.id })}
            />
            <button
              className="tex-del"
              title="Usuń teksturę"
              onClick={() => {
                removeCustomTexture(t.id);
                setCustom(loadCustomTextures());
                if (cur === t.id) setSettings({ groundTexture: undefined });
              }}
            >
              ×
            </button>
          </span>
        ))}
        <button className="tex-tile add" onClick={() => fileRef.current?.click()} title="Dodaj własną teksturę">
          +
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** Zapisane zestawy otoczenia — wbudowane i własne. */
function LandscapeSection() {
  const palace = useCurrentPalace();
  const setSettings = useStore((s) => s.setSettings);
  const showToast = useStore((s) => s.showToast);
  const [list, setList] = useState<LandscapePreset[]>(() => allLandscapes());
  return (
    <div className="env-section">
      <span className="env-title">Zapisane krajobrazy</span>
      <div className="ls-list">
        {list.map((p) => (
          <div key={p.id} className="ls-row">
            <button className="ls-name" onClick={() => { setSettings({ ...p.settings }); showToast(`Zastosowano: ${p.name}`); }}>
              {p.name}
            </button>
            {!p.builtin && (
              <button
                className="ls-del"
                title="Usuń zestaw"
                onClick={() => {
                  removeLandscape(p.id);
                  setList(allLandscapes());
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        className="btn small"
        onClick={() => {
          const name = prompt('Nazwa zestawu', 'Mój krajobraz');
          if (name === null) return;
          saveLandscape(name, palace.settings);
          setList(allLandscapes());
          showToast('Zapisano krajobraz');
        }}
      >
        <I.Download width={13} height={13} /> Zapisz bieżący jako…
      </button>
    </div>
  );
}

function FpLockHint() {
  const [locked, setLocked] = useState(!!document.pointerLockElement);
  useEffect(() => {
    const h = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', h);
    return () => document.removeEventListener('pointerlockchange', h);
  }, []);
  if (locked) return null;
  return (
    <div className="fp-hint">
      Kliknij scenę, aby się rozejrzeć. <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> — chodzenie, <kbd>Spacja</kbd> — skok, <kbd>F</kbd> — drzwi, <kbd>Enter</kbd> lub kliknięcie — dalej w spacerze.
    </div>
  );
}

function Joystick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active: number | null = null;
    const R = 40;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      setKnob({ x: dx, y: dy });
      onChange(dx / R, dy / R);
    };
    const down = (e: PointerEvent) => {
      active = e.pointerId;
      el.setPointerCapture(e.pointerId);
      move(e);
      e.stopPropagation();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      setKnob({ x: 0, y: 0 });
      onChange(0, 0);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onChange(0, 0);
    };
  }, [onChange]);
  return (
    <div ref={ref} className="joystick">
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
