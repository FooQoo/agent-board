import { LayersIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { epicInk } from '../lib/epic';
import type { EpicRef } from '../types';

export function EpicLabel({
  epic,
  className,
  disabled = false,
  stopPropagation = false,
  onClick,
}: {
  epic: EpicRef;
  className: string;
  disabled?: boolean;
  stopPropagation?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={className}
      data-epic-label={epic.id}
      style={{ background: epic.color, color: epicInk(epic.color) }}
      title={epic.name}
      disabled={disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (stopPropagation) event.stopPropagation();
        onClick();
      }}
    >
      <LayersIcon aria-hidden="true" focusable="false" />
      <span>{epic.id}</span>
    </button>
  );
}
