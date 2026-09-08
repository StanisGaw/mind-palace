import type { ReactNode } from 'react';

export type TipSide = 'right' | 'left' | 'top' | 'bottom' | 'top-end';

/**
 * Podpowiedź pokazywana po najechaniu (tylko mysz — na dotyku CSS jej nie włącza).
 * Opakowuje przycisk, więc działa też dla przycisków wyłączonych.
 */
export function Tip({ label, keys, side = 'right', className, children }: { label: string; keys?: string; side?: TipSide; className?: string; children: ReactNode }) {
  return (
    <span className={'tip-wrap tip-' + side + (className ? ` ${className}` : '')}>
      {children}
      <span className="tip" role="tooltip">
        {label}
        {keys && <kbd>{keys}</kbd>}
      </span>
    </span>
  );
}
