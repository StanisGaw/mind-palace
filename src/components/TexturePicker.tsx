import { useRef, useState } from 'react';
import { textureThumb, texturesOfKind, type TextureKind } from '../three/textures';
import { addCustomTexture, loadCustomTextures, removeCustomTexture, type CustomTexture } from '../lib/textureStore';
import { useStore } from '../store';

/** Siatka wzorów danego rodzaju (nawierzchnia, podłoga, ściana) plus własne obrazy; `undefined` = sam kolor. */
export function TexturePicker({ kind, value, onChange }: { kind: TextureKind; value: string | undefined; onChange: (id: string | undefined) => void }) {
  const showToast = useStore((s) => s.showToast);
  const [custom, setCustom] = useState<CustomTexture[]>(() => loadCustomTextures());
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (f: File) => {
    try {
      const t = await addCustomTexture(f);
      setCustom(loadCustomTextures());
      onChange(t.id);
    } catch (e) {
      showToast((e as Error).message);
    }
  };
  return (
    <>
      <div className="tex-grid">
        <button className={'tex-tile none' + (!value ? ' on' : '')} onClick={() => onChange(undefined)} title="Bez tekstury — sam kolor">
          —
        </button>
        {texturesOfKind(kind).map((t) => (
          <button key={t.id} className={'tex-tile' + (value === t.id ? ' on' : '')} style={{ backgroundImage: `url(${textureThumb(t.id)})` }} title={t.name} onClick={() => onChange(t.id)} />
        ))}
        {custom.map((t) => (
          <span key={t.id} className="tex-wrap">
            <button className={'tex-tile' + (value === t.id ? ' on' : '')} style={{ backgroundImage: `url(${t.dataUrl})` }} title={t.name} onClick={() => onChange(t.id)} />
            <button
              className="tex-del"
              title="Usuń teksturę"
              onClick={() => {
                removeCustomTexture(t.id);
                setCustom(loadCustomTextures());
                if (value === t.id) onChange(undefined);
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
    </>
  );
}
