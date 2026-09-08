import { ROOM_PRESETS } from '../lib/presets';
import { buildingOf, isFacade, isInPlace } from '../lib/rooms';
import { useCurrentPalace, useStore } from '../store';
import { I } from './Icons';

/** Wybór gotowego układu pokoju (wbudowane i własne) dla bieżącego wnętrza. */
export function RoomPresets() {
  const palace = useCurrentPalace();
  const activeBuildingId = useStore((s) => s.activeBuildingId);
  // wnętrze ładowane osobno albo odsłonięty budynek z wnętrzem w miejscu — wtedy liczą się tylko obiekty w nim
  const building = !palace.interior ? palace.objects.find((o) => o.id === activeBuildingId && isInPlace(o)) : undefined;
  const buildingType = palace.interior?.buildingType ?? building?.type;
  const customPresets = useStore((s) => s.customPresets);
  const applyRoomPreset = useStore((s) => s.applyRoomPreset);
  const saveCurrentAsPreset = useStore((s) => s.saveCurrentAsPreset);
  const deleteCustomPreset = useStore((s) => s.deleteCustomPreset);
  if (!buildingType) return null;
  const inside = building ? palace.objects.filter((o) => !isFacade(o.type) && buildingOf(palace.objects, o)?.id === building.id) : palace.objects;
  const isEmpty = inside.length === 0;

  const list = [...ROOM_PRESETS, ...customPresets].filter((p) => !p.buildingTypes || p.buildingTypes.includes(buildingType));
  const unnoted = inside.filter((o) => !o.note);

  return (
    <div className="room-presets">
      <div className="cat-head static">
        <span className="cat-title">{isEmpty ? 'Wybierz układ pokoju' : 'Układy pokoju'}</span>
      </div>
      <p className="lead" style={{ marginTop: 0 }}>Układ zastępuje obiekty bez notatek; te z notatkami zawsze zostają.</p>
      {(
        <div className="room-presets-list">
          {list.map((preset) => (
            <div key={preset.id} className="item-row" style={{ alignItems: 'flex-start' }}>
              <span className="txt">
                <div className="name">{preset.name}</div>
                <div className="sub">{preset.description}</div>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch' }}>
                <button
                  className="btn small"
                  onClick={() => {
                    if (
                      unnoted.length > 0 &&
                      !confirm(`Układ zastąpi ${unnoted.length} obiektów bez notatek. Obiekty z notatkami zostaną. Kontynuować?`)
                    )
                      return;
                    applyRoomPreset(preset.id);
                  }}
                >
                  Zastosuj
                </button>
                {preset.custom && (
                  <button className="btn small danger" onClick={() => deleteCustomPreset(preset.id)}>
                    Usuń
                  </button>
                )}
              </span>
            </div>
          ))}
          {list.length === 0 && <div className="empty">Brak układów dla tego budynku.</div>}
          {!building && <button
            className="btn small"
            onClick={() => {
              const name = prompt('Nazwa układu', 'Mój układ');
              if (name === null) return;
              saveCurrentAsPreset(name.trim() || 'Mój układ');
            }}
          >
            <I.Download width={13} height={13} /> Zapisz obecny układ
          </button>}
        </div>
      )}
    </div>
  );
}
