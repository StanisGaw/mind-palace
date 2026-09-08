import type { ReactNode } from 'react';

export type TipSide = 'right' | 'left' | 'top' | 'bottom' | 'top-end';

/**
 * Podpowiedź pokazywana po najechaniu (tylko mysz — na dotyku CSS jej nie włącza).
 * Opakowuje przycisk, więc działa też dla przycisków wyłączonych.
 */
export function Tip({ label, keys, side = 'right', children }: { label: string; keys?: string; side?: TipSide; children: ReactNode }) {
  return (
    <span className={'tip-wrap tip-' + side}>
      {children}
      <span className="tip" role="tooltip">
        {label}
        {keys && <kbd>{keys}</kbd>}
      </span>
    </span>
  );
}
