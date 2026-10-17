import { LayersIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { epicInk } from '../lib/epic';
import type { EpicRef } from '../types';

/** The epic's color and the ink that reads on it. Shared by every epic label. */
export function epicBadgeStyle(epic: EpicRef): CSSProperties {
  return { background: epic.color, color: epicInk(epic.color) };
}

/** The icon and the ID of an epic label. The host element supplies its own class and role. */
export function EpicBadgeContent({ epic }: { epic: EpicRef }) {
  return (
    <>
      <LayersIcon aria-hidden="true" focusable="false" />
      <span>{epic.id}</span>
    </>
  );
}

/** A non-interactive epic label, for places where the row itself is the button. */
export function EpicBadge({ epic, className }: { epic: EpicRef; className: string }) {
  return (
    <span
      className={className}
      data-epic-label={epic.id}
      style={epicBadgeStyle(epic)}
      title={epic.name}
    >
      <EpicBadgeContent epic={epic} />
    </span>
  );
}
