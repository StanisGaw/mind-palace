import { useMemo, useState } from 'react';
import { CATALOG, CATEGORY_LABELS, CATEGORY_ORDER, catalogItem } from '../catalog';
import type { Category } from '../types';
import { useCurrentPalace, useStore } from '../store';
import { usePref } from '../lib/prefs';
import { insideGround } from '../lib/ground';
import { I } from './Icons';
import { RoomPresets } from './RoomPresets';
import { isDrawn, isInPlace } from '../lib/rooms';

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setLeftTab);
  const palace = useCurrentPalace();
  const [q, setQ] = useState('');
  // układy pokoju istnieją we wnętrzu i dla odsłoniętego budynku z wnętrzem w miejscu — poza tym zakładka znika
  const activeBuildingId = useStore((s) => s.activeBuildingId);
  const presetsTab = !!palace.interior || (!!activeBuildingId && palace.objects.some((o) => o.id === activeBuildingId && isInPlace(o)));
  const activeTab = tab === 'presets' && !presetsTab ? 'library' : tab;

  return (
    <aside className="panel left">
      <div className="panel-head">
        <div className="eyebrow">Twoja wyobraźnia, Twoje zasady</div>
        <div className="headline">Zbuduj swoje miejsce.</div>
        <div className="tabs">
          <button className={'tab' + (activeTab === 'library' ? ' active' : '')} onClick={() => setTab('library')}>
            Biblioteka
          </button>
          <button className={'tab' + (activeTab === 'scene' ? ' active' : '')} onClick={() => setTab('scene')}>
            Na scenie <span className="count">{palace.objects.length}</span>
          </button>
          {presetsTab && (
            <button className={'tab' + (activeTab === 'presets' ? ' active' : '')} onClick={() => setTab('presets')}>
              Układy
            </button>
          )}
        </div>
      </div>
      <div className="scroll">
        {activeTab !== 'presets' && (
          <label className="search">
            <I.Search width={14} height={14} />
            <input placeholder="Znajdź coś wyjątkowego…" value={q} onChange={(e) => setQ(e.target.value)} />
            <kbd>/</kbd>
          </label>
        )}
        {activeTab === 'library' ? <Library q={q} /> : activeTab === 'scene' ? <SceneList q={q} /> : <RoomPresets />}
      </div>
      <div className="tip-card">
        <I.Spark className="ico" width={20} height={20} />
        <span>
          Wielkie wspomnienia
          <br />
          zaczynają się od małych miejsc.
        </span>
      </div>
    </aside>
  );
}

function Library({ q }: { q: string }) {
  const addObject = useStore((s) => s.addObject);
  const showToast = useStore((s) => s.showToast);
  const viewMode = useStore((s) => s.viewMode);
  const placing = useStore((s) => s.placing);
  const setPlacing = useStore((s) => s.setPlacing);
  const select = useStore((s) => s.select);
  const isInterior = !!useCurrentPalace().interior;
  // jedna aktywna kategoria albo „Wszystkie”; wyszukiwanie działa w ramach aktywnej
  const [category, setCategory] = usePref<string>('libCategory', 'all');
  // we wnętrzu nie stawiamy budynków, gór ani bramy; wyposażenie idzie na wierzch. Na planszy Konstrukcja
  // (ścianki, drzwi, schody) służy budynkom z wnętrzem w miejscu
  const cats: Category[] = isInterior
    ? (['structure', 'furniture', ...CATEGORY_ORDER.filter((c) => !['building', 'landscape', 'special', 'furniture', 'structure'].includes(c))] as Category[])
    : (['building', ...CATEGORY_ORDER.filter((c) => c !== 'building')] as Category[]);
  const active = cats.includes(category as Category) ? (category as Category) : 'all';
  const filtered = useMemo(
    () => CATALOG.filter((c) => !c.hidden && !(c.boardOnly && isInterior) && (!q || c.name.toLowerCase().includes(q.toLowerCase()) || c.description.toLowerCase().includes(q.toLowerCase()))),
    [q, isInterior],
  );
  const shownCats = active === 'all' ? cats : [active];

  const row = (item: (typeof CATALOG)[number]) => (
    <button
      key={item.id}
      className={'item-row' + (placing?.type === item.id && !placing.ids ? ' placing' : '')}
      title={placing?.type === item.id && !placing.ids ? (isDrawn(item.id) ? `Kliknij początek i koniec ${item.id === 'wall' ? 'ścianki' : 'ścieżki'} (Esc anuluje)` : 'Kliknij scenę, aby postawić (Esc anuluje)') : item.description}
      onClick={() => {
        if (viewMode !== 'editor') {
          addObject(item.id);
          showToast(`Dodano: ${item.name}. Wróć do edytora, aby ustawić obiekt.`);
          return;
        }
        // w edytorze najpierw pokazujemy podgląd, obiekt powstaje dopiero po kliknięciu w scenę
        if (placing?.type === item.id && !placing.ids) setPlacing(null);
        else {
          select(null);
          setPlacing({ type: item.id });
        }
      }}
    >
      <span className="ico">{item.emoji}</span>
      <span className="txt">
        <div className="name">{item.name}</div>
        <div className="sub">{item.description}</div>
      </span>
      <span className="add">{placing?.type === item.id && !placing.ids ? (isDrawn(item.id) ? 'Początek i koniec' : 'Kliknij scenę') : '+ Dodaj'}</span>
    </button>
  );

  const total = shownCats.reduce((n, cat) => n + filtered.filter((c) => c.category === cat).length, 0);
  return (
    <div>
      <div className="cat-chips">
        <button className={'cat-chip' + (active === 'all' ? ' on' : '')} onClick={() => setCategory('all')} title="Pokaż wszystkie kategorie">
          Wszystkie
        </button>
        {cats.map((cat) => (
          <button key={cat} className={'cat-chip' + (active === cat ? ' on' : '')} onClick={() => setCategory(cat)} title={`Pokaż tylko: ${CATEGORY_LABELS[cat]}`}>
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>
      {shownCats.map((cat) => {
        const items = filtered.filter((c) => c.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat}>
            {active === 'all' && (
              <div className="cat-head static">
                <span className="cat-title">
                  {CATEGORY_LABELS[cat]}
                  <span className="cnt">{items.length}</span>
                </span>
              </div>
            )}
            {items.map(row)}
          </div>
        );
      })}
      {total === 0 && <div className="empty">{q ? `Nic nie znaleziono${active === 'all' ? '' : ` w kategorii ${CATEGORY_LABELS[active]}`}.` : 'Ta kategoria jest pusta.'}</div>}
    </div>
  );
}

function SceneList({ q }: { q: string }) {
  const palace = useCurrentPalace();
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const flyTo = useStore((s) => s.flyTo);
  const list = palace.objects.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  if (palace.objects.length === 0) return <div className="empty">Scena jest pusta. Dodaj coś z biblioteki.</div>;
  return (
    <div style={{ paddingTop: 6 }}>
      {list.map((o) => {
        const item = catalogItem(o.type);
        return (
          <button
            key={o.id}
            className={'item-row' + (selectedIds.includes(o.id) ? ' selected' : '')}
            onClick={(e) => (e.shiftKey ? toggleSelected(o.id) : select(o.id))}
            onDoubleClick={() => flyTo(o.id)}
          >
            <span className="ico">{item.emoji}</span>
            <span className="txt">
              <div className="name">
                {o.name}
                {o.groupId && <span className="badge-group" title="Obiekt należy do grupy">grupa</span>}
                {!insideGround(palace.settings.ground, o.position[0], o.position[2]) && (
                  <span className="off-plate" title="Stoi poza planszą, w krajobrazie">
                    poza planszą
                  </span>
                )}
              </div>
              <div className={'sub' + (o.note ? ' has' : '')}>{o.note ? 'Ma przypisane wspomnienie' : 'Czeka na Twoją historię'}</div>
            </span>
            <I.Chevron className="chev" width={14} height={14} />
          </button>
        );
      })}
      {list.length === 0 && <div className="empty">Brak dopasowań.</div>}
    </div>
  );
}
