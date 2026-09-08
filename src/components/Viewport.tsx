import { useEffect, useRef, useState } from 'react';
import { AMBIENCES, SCENERIES, WEATHERS } from '../catalog';
import { GROUND_SHAPES } from '../lib/ground';
import { TexturePicker } from './TexturePicker';
import { allLandscapes, removeLandscape, saveLandscape, type LandscapePreset } from '../lib/landscapes';
import type { Scenery, SoundLevels, Weather } from '../types';
import { useCurrentPalace, useStore } from '../store';
import { SceneManager } from '../three/SceneManager';
import { I } from './Icons';
import { catalogItem } from '../catalog';
import { COARSE_Q, useMediaQuery } from '../lib/media';
import { isDrawn, maxFloorsOf } from '../lib/rooms';
import { ReviewOverlay } from './ReviewOverlay';
import { Tip } from './Tip';

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
  const activeBuildingId = useStore((s) => s.activeBuildingId);
  const isTouch = useMediaQuery(COARSE_Q);
  const placing = useStore((s) => s.placing);
  const setPlacing = useStore((s) => s.setPlacing);
  const [sticky, setSticky] = useState(false);
  useEffect(() => {
    if (!placing) {
      setSticky(false);
      if (mgrRef.current) mgrRef.current.stickyPlacing = false;
    }
  }, [placing]);

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
        (viewMode === 'fp' ? ' fp-mode' : '') +
        (review ? ' review-mode' : '') +
        (palace.interior || activeBuildingId ? ' in-building' : '')
      }
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

      {/* góra-lewo: tryb */}
      <div className="hud hud-top-left">
        <span className={'chip' + (review ? ' warm' : '')}>
          <span className="dot" /> {review ? 'Spacer pamięci' : modeChip}
        </span>
        <div className="segmented">
          <Tip label="Edytor: budowanie pałacu" side="bottom">
            <button className={viewMode === 'editor' ? 'active' : ''} onClick={() => setViewMode('editor')}>
              <I.Cube width={13} height={13} style={{ verticalAlign: -2, marginRight: 5 }} />
              Edytor
            </button>
          </Tip>
          <Tip label="Spacer w pierwszej osobie" side="bottom">
            <button className={viewMode === 'fp' ? 'active' : ''} onClick={() => setViewMode('fp')}>
              <I.Eye width={13} height={13} style={{ verticalAlign: -2, marginRight: 5 }} />Z oczu
            </button>
          </Tip>
          <Tip label="VR: gogle lub telefon w Cardboard" side="bottom">
            <button
              className={viewMode === 'vr' ? 'active' : ''}
              onClick={() => {
                // pełny ekran trzeba poprosić w samym dotknięciu — po pierwszym await
                // (sprawdzenie WebXR, zgoda na czujniki) przeglądarka już odmawia
                enterFullscreen();
                setViewMode('vr');
              }}
            >
              <I.Vr width={13} height={13} style={{ verticalAlign: -2, marginRight: 5 }} />
              VR
            </button>
          </Tip>
        </div>
      </div>

      {/* góra-prawo: otoczenie */}
      <div className="hud hud-top-right">
        <SoundMenu />
        <span className="hud-env">
          <EnvironmentMenu />
        </span>
      </div>

      {/* narzędzia */}
      {viewMode === 'editor' && (
        <div className="hud tools hud-tools-left">
          <Tip label="Zaznacz" keys="V">
            <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}>
              <I.Cursor />
            </button>
          </Tip>
          <Tip label="Przesuń i obróć" keys="M">
            <button className={tool === 'move' ? 'active' : ''} onClick={() => setTool('move')}>
              <I.Move />
            </button>
          </Tip>
          <div className="sep" />
          <Tip label="Cofnij" keys="Ctrl+Z">
            <button onClick={undo} disabled={!canUndo}>
              <I.Undo />
            </button>
          </Tip>
          <Tip label="Ponów" keys="Ctrl+Shift+Z">
            <button onClick={redo} disabled={!canRedo}>
              <I.Redo />
            </button>
          </Tip>
        </div>
      )}

      {viewMode === 'editor' && (
        <div className="hud compass hud-compass">
          <svg width="26" height="26" viewBox="0 0 24 24">
            <path d="M12 3l4 9h-8z" fill="var(--accent)" />
            <path d="M12 21l-4-9h8z" fill="var(--border-2)" />
          </svg>
          N
        </div>
      )}

      {/* dół-prawo: kamera */}
      <div className="hud tools hud-camera">
        <Tip label="Przybliż" side="left">
          <button className="zoom-btn" onClick={() => camera('zoomIn')} disabled={viewMode !== 'editor'}>
            <I.Plus />
          </button>
        </Tip>
        <Tip label="Oddal" side="left">
          <button className="zoom-btn" onClick={() => camera('zoomOut')} disabled={viewMode !== 'editor'}>
            <I.Minus />
          </button>
        </Tip>
        <div className="sep" />
        <Tip label="Wyśrodkuj widok" keys="F" side="left">
          <button onClick={() => camera('center')}>
            <I.Center />
          </button>
        </Tip>
        <Tip label="Rzut z góry" keys="T" side="left">
          <button className={topView ? 'active' : ''} onClick={() => camera('topView')} disabled={viewMode !== 'editor'}>
            <I.TopView />
          </button>
        </Tip>
        <Tip label="Pełny ekran" side="left">
          <button onClick={toggleFullscreen}>
            <I.Fullscreen />
          </button>
        </Tip>
      </div>

      {/* dół: podpowiedzi i przełączniki */}
      <div className="hud hint hud-hint">
        {viewMode === 'editor' ? (
          <>
            <span>
              <I.Cursor width={12} height={12} /> Środkowy przycisk: obróć widok
            </span>
            <span>Prawy przycisk: przesuń widok</span>
            <span>Kółko: przybliż</span>
            <span>M: strzałki przesuwają, pierścienie obracają</span>
            <span>Del: usuń obiekt</span>
          </>
        ) : viewMode === 'fp' ? (
          <span>
            <I.Eye width={12} height={12} /> WASD — chodzenie · Spacja — skok · F — drzwi · Esc — kursor
          </span>
        ) : null}
      </div>
      <div className="hud toggles hud-toggles">
        <Tip label="Siatka i przyciąganie co pół metra" side="top-end" className="toggle-grid">
          <button className={'toggle' + (palace.settings.grid ? ' on' : '')} onClick={() => setSettings({ grid: !palace.settings.grid })}>
            <I.Grid width={13} height={13} /> Siatka
          </button>
        </Tip>
        <Tip label="Linia ścieżki pamięci" side="top-end">
          <button className={'toggle' + (palace.settings.showPath ? ' on' : '')} onClick={() => setSettings({ showPath: !palace.settings.showPath })}>
            <I.Path width={13} height={13} /> Ścieżka
          </button>
        </Tip>
      </div>

      {viewMode === 'editor' && isTouch && placing && (
        <div className="hud placing-bar">
          <span className="placing-label">{placing.ids ? 'Kopia' : catalogItem(placing.type).name}</span>
          {!isDrawn(placing.type) && (
            <button onClick={() => mgrRef.current?.rotateGhost()} title="Obróć podgląd o 15°">
              <I.Rotate width={14} height={14} /> Obróć
            </button>
          )}
          <button
            className={sticky ? 'active' : ''}
            onClick={() => {
              setSticky((v) => {
                if (mgrRef.current) mgrRef.current.stickyPlacing = !v;
                return !v;
              });
            }}
            title="Po postawieniu zostań w trybie stawiania"
          >
            Wiele
          </button>
          <button onClick={() => setPlacing(null)} title="Anuluj stawianie">
            <I.X width={14} height={14} /> Anuluj
          </button>
        </div>
      )}

      {viewMode !== 'editor' && !vrActive && doorPrompt && (
        <button
          className="door-prompt"
          onClick={() => mgrRef.current?.useDoor()}
        >
          <I.Door width={15} height={15} /> {doorPrompt.label} {!isTouch && <kbd>F</kbd>}
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
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [open]);
  const s = palace.settings;
  const ambName = AMBIENCES.find((a) => a.id === s.ambience)?.name ?? s.ambience;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Tip label="Otoczenie: pora dnia, pogoda, krajobraz" side="bottom">
        <button className="toggle" onClick={() => setOpen((o) => !o)}>
          <I.Leaf width={13} height={13} /> {ambName}
          <I.ChevronDown width={12} height={12} />
        </button>
      </Tip>
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
          {palace.interior ? <FloorsSection /> : <GroundSection />}
          {!palace.interior && <ActiveBuildingSection />}
          <TextureSection />
          {!palace.interior && <LandscapeSection />}
        </div>
      )}
    </div>
  );
}

const SOUND_LAYERS: { id: keyof SoundLevels; name: string }[] = [
  { id: 'rain', name: 'Deszcz' },
  { id: 'storm', name: 'Burza' },
  { id: 'snow', name: 'Śnieg' },
  { id: 'wind', name: 'Wiatr' },
  { id: 'animals', name: 'Zwierzęta' },
  { id: 'crickets', name: 'Świerszcze' },
];

/** Suwaki głośności dźwięków otoczenia; każda warstwa gra niezależnie od ustawionej pogody. */
function SoundMenu() {
  const sound = useStore((s) => s.sound);
  const setSound = useStore((s) => s.setSound);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [open]);
  const playing = sound.master > 0 && SOUND_LAYERS.some((l) => sound[l.id] > 0);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Tip label="Dźwięki otoczenia" side="bottom">
        <button className={'toggle' + (playing ? ' on' : '')} onClick={() => setOpen((o) => !o)}>
          <I.Sound width={13} height={13} /> Dźwięki
          <I.ChevronDown width={12} height={12} />
        </button>
      </Tip>
      {open && (
        <div className="env-menu sound-menu">
          <label>
            <span>Głośność ogólna: {pct(sound.master)}</span>
            <input type="range" min={0} max={1} step={0.01} value={sound.master} onChange={(e) => setSound({ master: Number(e.target.value) })} />
          </label>
          <div className="env-section">
            <span className="env-title">Warstwy</span>
            {SOUND_LAYERS.map((l) => (
              <label key={l.id}>
                <span>
                  {l.name}: {pct(sound[l.id])}
                </span>
                <input type="range" min={0} max={1} step={0.01} value={sound[l.id]} onChange={(e) => setSound({ [l.id]: Number(e.target.value) })} />
              </label>
            ))}
            <button
              className="btn small"
              onClick={() => setSound({ rain: 0, storm: 0, snow: 0, wind: 0, animals: 0, crickets: 0 })}
              disabled={!SOUND_LAYERS.some((l) => sound[l.id] > 0)}
            >
              Wycisz wszystkie warstwy
            </button>
          </div>
          <p className="sound-note">
            Świerszcze grają głośniej nocą, a we wnętrzach dźwięki są stłumione. Nagrania pochodzą z Wikimedia Commons{' '}
            <a href={`${import.meta.env.BASE_URL}sounds/CREDITS.txt`} target="_blank" rel="noreferrer">
              (autorzy i licencje)
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}

/** Liczba pięter budynku i wybór piętra do edycji (zamiast planszy — wnętrze nie ma terenu). */
function FloorsSection() {
  const palace = useCurrentPalace();
  const setFloors = useStore((s) => s.setFloors);
  const editFloor = useStore((s) => s.editFloor);
  const setEditFloor = useStore((s) => s.setEditFloor);
  const floors = palace.interior?.floors ?? 1;
  return (
    <div className="env-section">
      <span className="env-title">Piętra</span>
      <label>
        <span>Liczba pięter: {floors}</span>
        <div className="shape-row">
          <button className="shape-btn" onClick={() => setFloors(floors - 1)} disabled={floors <= 1}>
            − Mniej
          </button>
          <button className="shape-btn" onClick={() => setFloors(floors + 1)} disabled={floors >= 4}>
            + Więcej
          </button>
        </div>
      </label>
      <div className="shape-row">
        {Array.from({ length: floors }, (_, i) => (
          <button key={i} className={'shape-btn' + (editFloor === i ? ' on' : '')} onClick={() => setEditFloor(i)}>
            {i === 0 ? 'Parter' : `Piętro ${i}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Piętra aktywnego budynku z wnętrzem w miejscu (na planszy). */
function ActiveBuildingSection() {
  const palace = useCurrentPalace();
  const activeBuildingId = useStore((s) => s.activeBuildingId);
  const editFloor = useStore((s) => s.editFloor);
  const setEditFloor = useStore((s) => s.setEditFloor);
  const setBuildingFloors = useStore((s) => s.setBuildingFloors);
  const b = palace.objects.find((o) => o.id === activeBuildingId);
  if (!b || b.interiorMode !== 'inplace') return null;
  const floors = b.floors ?? 1;
  return (
    <div className="env-section">
      <span className="env-title">Piętra: {b.name}</span>
      <label>
        <span>Liczba pięter: {floors}</span>
        <div className="shape-row">
          <button className="shape-btn" onClick={() => setBuildingFloors(b.id, floors - 1)} disabled={floors <= 1}>
            − Mniej
          </button>
          <button className="shape-btn" onClick={() => setBuildingFloors(b.id, floors + 1)} disabled={floors >= maxFloorsOf(b.type)}>
            + Więcej
          </button>
        </div>
      </label>
      <div className="shape-row">
        {Array.from({ length: floors }, (_, i) => (
          <button key={i} className={'shape-btn' + (editFloor === i ? ' on' : '')} onClick={() => setEditFloor(i)}>
            {i === 0 ? 'Parter' : `Piętro ${i}`}
          </button>
        ))}
      </div>
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

/** Nawierzchnia planszy albo podłoga i ściany pokoju ładowanego. */
function TextureSection() {
  const palace = useCurrentPalace();
  const setSettings = useStore((s) => s.setSettings);
  return (
    <>
      <div className="env-section">
        <span className="env-title">{palace.interior ? 'Podłoga' : 'Nawierzchnia'}</span>
        <TexturePicker kind={palace.interior ? 'floor' : 'ground'} value={palace.settings.groundTexture} onChange={(id) => setSettings({ groundTexture: id })} />
      </div>
      {palace.interior && (
        <div className="env-section">
          <span className="env-title">Ściany</span>
          <TexturePicker kind="wall" value={palace.settings.wallTexture} onChange={(id) => setSettings({ wallTexture: id })} />
        </div>
      )}
    </>
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
  // `onChange` to nowa funkcja przy każdym renderze widoku (np. gdy pojawia się podpowiedź drzwi);
  // nasłuchy muszą przeżyć render, inaczej palec traci gałkę w połowie ruchu
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = (x: number, y: number) => onChangeRef.current(x, y);
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
  }, []);
  return (
    <div ref={ref} className="joystick">
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
