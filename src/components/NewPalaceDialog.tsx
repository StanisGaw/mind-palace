import { useState } from 'react';
import { useStore } from '../store';
import { DEFAULT_TEMPLATE, PALACE_TEMPLATES } from '../lib/templates';
import { I } from './Icons';

/** Nowy pałac: nazwa i wybór zawartości — pusta plansza albo gotowa kompozycja. */
export function NewPalaceDialog({ onClose }: { onClose: () => void }) {
  const createPalace = useStore((s) => s.createPalace);
  const roots = useStore((s) => s.data.palaces.filter((p) => !p.parentId).length);
  const [name, setName] = useState(`Nowy pałac ${roots + 1}`);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);

  const create = () => {
    createPalace(name.trim() || undefined, template);
    onClose();
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose} title="Zamknij">
          <I.X />
        </button>
        <h2>Nowy pałac</h2>
        <p>Nazwę i wszystko w środku zmienisz później — zawartość to tylko punkt wyjścia.</p>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="new-palace-name">Nazwa</label>
          <input
            id="new-palace-name"
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
            }}
          />
        </div>
        <h3>Zawartość</h3>
        <div className="tpl-grid">
          {PALACE_TEMPLATES.map((t) => (
            <button key={t.id} className={'tpl-card' + (t.id === template ? ' on' : '')} onClick={() => setTemplate(t.id)} onDoubleClick={create}>
              <span className="tpl-emoji">{t.emoji}</span>
              <b>{t.name}</b>
              <span className="tpl-desc">{t.description}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="btn ghost" onClick={onClose}>
            Anuluj
          </button>
          <button className="btn primary" onClick={create}>
            <I.Plus width={12} height={12} /> Utwórz pałac
          </button>
        </div>
      </div>
    </div>
  );
}
