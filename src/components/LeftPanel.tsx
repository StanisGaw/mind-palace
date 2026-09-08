import { useMemo, useState } from 'react';
import { CATALOG, CATEGORY_LABELS, CATEGORY_ORDER, catalogItem } from '../catalog';
import type { Category } from '../types';
import { useCurrentPalace, useStore } from '../store';
import { usePref } from '../lib/prefs';
import { insideGround } from '../lib/ground';
import { I } from './Icons';
import { RoomPresets } from './RoomPresets';

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setLeftTab);
  const palace = useCurrentPalace();
  const [q, setQ] = useState('');

  return (
    <aside className="panel left">
      <div className="panel-head">
        <div className="eyebrow">Twoja wyobraźnia, Twoje zasady</div>
        <div className="headline">Zbuduj swoje miejsce.</div>
        <div className="tabs">
          <button className={'tab' + (tab === 'library' ? ' active' : '')} onClick={() => setTab('library')}>
            Biblioteka
          </button>
          <button className={'tab' + (tab === 'scene' ? ' active' : '')} onClick={() => setTab('scene')}>
            Na scenie <span className="count">{palace.objects.length}</span>
          </button>
        </div>
      </div>
      <div className="scroll">
        <label className="search">
          <I.Search width={14} height={14} />
          <input placeholder="Znajdź coś wyjątkowego…" value={q} onChange={(e) => setQ(e.target.value)} />
          <kbd>/</kbd>
        </label>
        {tab === 'library' ? <Library q={q} /> : <SceneList q={q} />}
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
  const [collapsed, setCollapsed] = usePref<string[]>('libCollapsed', []);
  const [hidden, setHidden] = usePref<string[]>('libHidden', []);
  // we wnętrzu nie stawiamy budynków, gór ani bramy; wyposażenie idzie na wierzch. Na planszy Konstrukcja
  // (ścianki, drzwi, schody) służy budynkom z wnętrzem w miejscu
  const cats: Category[] = isInterior
    ? (['structure', 'furniture', ...CATEGORY_ORDER.filter((c) => !['building', 'landscape', 'special', 'furniture', 'structure'].includes(c))] as Category[])
    : (['building', ...CATEGORY_ORDER.filter((c) => c !== 'building')] as Category[]);
  const searching = q.trim().length > 0;
  const filtered = useMemo(
    () => CATALOG.filter((c) => !c.hidden && (!q || c.name.toLowerCase().includes(q.toLowerCase()) || c.description.toLowerCase().includes(q.toLowerCase()))),
    [q],
  );
  const toggle = (list: string[], set: (v: string[]) => void, cat: string) =>
    set(list.includes(cat) ? list.filter((c) => c !== cat) : [...list, cat]);
  const visibleCats = cats.filter((c) => searching || !hidden.includes(c));

  return (
    <div>
      {isInterior && <RoomPresets />}
      <div className="cat-chips">
        {cats.map((cat) => (
          <button
            key={cat}
            className={'cat-chip' + (hidden.includes(cat) ? '' : ' on')}
            onClick={() => toggle(hidden, setHidden, cat)}
            title={hidden.includes(cat) ? 'Pokaż kategorię' : 'Ukryj kategorię'}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>
      {visibleCats.map((cat) => {
        const items = filtered.filter((c) => c.category === cat);
        if (items.length === 0) return null;
        const isCollapsed = !searching && collapsed.includes(cat);
        return (
          <div key={cat}>
            <button className={'cat-head' + (isCollapsed ? ' collapsed' : '')} onClick={() => toggle(collapsed, setCollapsed, cat)}>
              <span className="cat-title">
                {CATEGORY_LABELS[cat]}
                <span className="cnt">{items.length}</span>
              </span>
              <I.Down className="chev" width={14} height={14} />
            </button>
            {!isCollapsed &&
              items.map((item) => (
                <button
                  key={item.id}
                  className={'item-row' + (placing?.type === item.id ? ' placing' : '')}
                  title={placing?.type === item.id ? (item.id === 'wall' ? 'Kliknij początek i koniec ścianki (Esc anuluje)' : 'Kliknij scenę, aby postawić (Esc anuluje)') : item.description}
                  onClick={() => {
                    if (viewMode !== 'editor') {
                      addObject(item.id);
                      showToast(`Dodano: ${item.name}. Wróć do edytora, aby ustawić obiekt.`);
                      return;
                    }
                    // w edytorze najpierw pokazujemy podgląd, obiekt powstaje dopiero po kliknięciu w scenę
                    if (placing?.type === item.id) setPlacing(null);
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
                  <span className="add">{placing?.type === item.id ? (item.id === 'wall' ? 'Początek i koniec' : 'Kliknij scenę') : '+ Dodaj'}</span>
                </button>
              ))}
          </div>
        );
      })}
      {filtered.length === 0 && <div className="empty">Nic nie znaleziono.</div>}
      {filtered.length > 0 && visibleCats.length === 0 && <div className="empty">Wszystkie kategorie są ukryte.</div>}
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
