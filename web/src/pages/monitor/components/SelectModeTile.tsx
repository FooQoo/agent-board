import { ListChecksIcon } from 'lucide-react';
import { LaneEdgeTile } from './LaneEdgeTile';

export interface SelectModeTileProps {
  /** How far (px, positive is right) the Backlog lane has followed the finger. */
  offset: number;
}

/**
 * The tile the Backlog lane uncovers on its left while it is swiped right: the select tile of a
 * card, growing from a dot as the lane slides. It only shows what the release will do (start the
 * selection mode, with nothing picked, as the Select cards button does); it takes no press and is
 * hidden from assistive technology, which have the Select cards button after the lane's cards.
 */
export function SelectModeTile({ offset }: SelectModeTileProps) {
  return <LaneEdgeTile offset={offset} side="left" icon={ListChecksIcon} />;
}
