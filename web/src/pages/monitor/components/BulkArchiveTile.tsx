import { ArchiveXIcon } from 'lucide-react';
import { LaneEdgeTile } from './LaneEdgeTile';

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
  return <LaneEdgeTile offset={offset} side="right" icon={ArchiveXIcon} archive />;
}
