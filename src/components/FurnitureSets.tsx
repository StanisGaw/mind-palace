import { FURNITURE_SETS } from '../lib/sets';
import { isInPlace } from '../lib/rooms';
import { useCurrentPalace, useStore } from '../store';
import { I } from './Icons';

/** Zestawy mebli do postawienia w bieżącej scenie: te same w każdym rodzaju budynku. */
export function FurnitureSets() {
  const palace = useCurrentPalace();
  const activeBuildingId = useStore((s) => s.activeBuildingId);
  const customSets = useStore((s) => s.customSets);
  const setPlacing = useStore((s) => s.setPlacing);
  const saveSelectionAsSet = useStore((s) => s.saveSelectionAsSet);
  const deleteCustomSet = useStore((s) => s.deleteCustomSet);
  const selectedIds = useStore((s) => s.selectedIds);
  // we wnętrzu stawiamy meble, na planszy zestawy ogrodowe; własne zestawy widać wszędzie, bo tylko
  // użytkownik wie, gdzie ich chciał użyć
  const inside = !!palace.interior || (!!activeBuildingId && palace.objects.some((o) => o.id === activeBuildingId && isInPlace(o)));
  const list = [...FURNITURE_SETS, ...customSets].filter((s) => (inside ? !s.outdoor : s.outdoor || s.custom));

  return (
    <div className="room-presets">
      <div className="cat-head static">
        <span className="cat-title">Zestawy</span>
      </div>
      <p className="lead" style={{ marginTop: 0 }}>
        {inside
          ? 'Wybierz zestaw, przesuń podgląd i kliknij w scenie. Zestaw z tyłem sam ustawia się do ściany, a kółko myszy obraca go ręcznie.'
          : 'Na planszy stawia się zestawy ogrodowe. Wejdź do budynku, żeby zobaczyć zestawy wnętrz.'}
      </p>
      <div className="room-presets-list">
        {list.map((set) => (
          <div key={set.id} className="item-row" style={{ alignItems: 'flex-start' }}>
            <span className="txt">
              <div className="name">{set.name}</div>
              <div className="sub">{set.description || `${set.objects.length} obiektów, ${set.width.toFixed(1)} × ${set.depth.toFixed(1)} m`}</div>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch' }}>
              <button className="btn small" onClick={() => setPlacing({ type: 'set', setId: set.id })}>
                Postaw
              </button>
              {set.custom && (
                <button className="btn small danger" onClick={() => deleteCustomSet(set.id)}>
                  Usuń
                </button>
              )}
            </span>
          </div>
        ))}
        {list.length === 0 && <div className="empty">Brak zestawów dla tego miejsca.</div>}
        <button
          className="btn small"
          disabled={selectedIds.length === 0}
          onClick={() => {
            const name = prompt('Nazwa zestawu', 'Mój zestaw');
            if (name === null) return;
            saveSelectionAsSet(name.trim() || 'Mój zestaw');
          }}
        >
          <I.Download width={13} height={13} /> Zapisz zaznaczenie jako zestaw
        </button>
      </div>
    </div>
  );
}
