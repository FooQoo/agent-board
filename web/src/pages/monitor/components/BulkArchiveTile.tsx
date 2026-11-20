import { ArchiveXIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { revealProgress } from '@/shared/lib/gesture/cardReveal';
import { BULK_WIDTH } from '../hooks/useLaneOverscroll';
import './monitor-lanes.css';

export interface BulkArchiveTileProps {
  /** How far (px, negative is left) the Done lane has followed the finger. */
  offset: number;
}

/**
 * The tile the Done lane uncovers on its right while it is swiped left: the same look as the
 * archive tile of a card, growing from a dot as the lane slides. It only shows what the release
 * will do; it takes no press and is hidden from assistive technology, which have the Archive all
 * button after the lane's cards.
 */
export function BulkArchiveTile({ offset }: BulkArchiveTileProps) {
  const shown = offset < 0;
  return (
    <div
      className="swipe-card__actions"
      data-side="right"
      data-revealed={shown || undefined}
      data-bulk-tile=""
      aria-hidden="true"
      style={
        {
          width: `${shown ? Math.min(BULK_WIDTH, Math.abs(offset)) : 0}px`,
          '--reveal': shown ? revealProgress(offset, BULK_WIDTH) : 0,
          pointerEvents: 'none',
        } as CSSProperties
      }
    >
      <div className="swipe-card__tile swipe-card__tile--archive">
        <ArchiveXIcon aria-hidden="true" />
      </div>
    </div>
  );
}
