import type { MouseEvent } from 'react';
import type { EpicRef } from '../../../shared/api/contracts';
import { EpicBadgeContent, epicBadgeStyle } from './EpicBadge';

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
      style={epicBadgeStyle(epic)}
      title={epic.name}
      disabled={disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (stopPropagation) event.stopPropagation();
        onClick();
      }}
    >
      <EpicBadgeContent epic={epic} />
    </button>
  );
}
