import { useTranslation } from 'react-i18next';
import { type Edge, edgeTarget } from '../model/lanes';
import type { MonitorSection } from './MonitorSectionHeader';
import './monitor-lanes.css';

/**
 * The two strips at the screen edges while a card is lifted. A strip that leads to a lane names it
 * (`→ Doing`); the strip the finger rests in is highlighted. A lane at the end of the row has no
 * strip on that side.
 */
export function LaneEdges({
  lane,
  active,
}: {
  lane: MonitorSection;
  /** The strip the finger is in. */
  active: Edge | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      {(['left', 'right'] as const).map((edge) => {
        const target = edgeTarget(lane, edge);
        if (!target) return null;
        const name = t(`monitor.status.${target}`);
        return (
          <div
            key={edge}
            className="lane-edge"
            data-edge={edge}
            data-active={active === edge || undefined}
            aria-hidden="true"
          >
            <span className="lane-edge__label">
              {t(edge === 'right' ? 'monitor.lanes.toNext' : 'monitor.lanes.toPrev', {
                lane: name,
              })}
            </span>
          </div>
        );
      })}
    </>
  );
}
