import { ArchiveIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { IconLabel } from '@/shared/ui/icon-label';
import type { MonitorTask as MonitorTaskModel, MonitorViewProps } from '../contracts';
import { useLaneSwipe } from '../hooks/useLaneSwipe';
import { LANES, laneIndex, type RevealSide } from '../model/lanes';
import type { MonitorSection } from './MonitorSectionHeader';
import { MonitorTask } from './MonitorTask';
import { SwipeableCard } from './SwipeableCard';
import './monitor-lanes.css';

export type LaneItems = Record<MonitorSection, MonitorTaskModel[]>;

export interface MonitorLanesProps {
  /** The cards of each lane, already in the order they are shown. */
  lanes: LaneItems;
  /** The lane on screen. The screen owns it, so the tab bar and the swipes agree. */
  lane: MonitorSection;
  onLaneChange: (lane: MonitorSection) => void;
  /** A lane tile of a card was tapped: the screen asks for the move confirmation. */
  onMove: (item: MonitorTaskModel, target: MonitorSection) => void;
  /** The archive button of a card was tapped: the screen asks for the archive confirmation. */
  onArchive: (item: MonitorTaskModel) => void;
  /** 「まとめてアーカイブ」 of the done lane was tapped: the screen asks for the confirmation. */
  onBulkArchive: () => void;
  onOpenDetail?: MonitorViewProps['onOpenDetail'];
  onOpenAnswer?: (item: MonitorTaskModel) => void;
  answerController?: MonitorViewProps['answerController'];
  id?: string;
  /** A story's still picture: this card has its left-swipe tiles showing. */
  previewRevealed?: number;
}

const keyOf = (item: MonitorTaskModel) => `${item.projectId}:${item.task.id}`;

/**
 * The phone monitor's lanes: one lane on screen, the other two beside it on a track. Tabs and a
 * sideways swipe on empty space, or from the left or right edge of the screen, move the track. A
 * card slides left to show the lane on the right and the archive, or right to show the lane on the
 * left. Nothing here writes: every action is a callback.
 */
export function MonitorLanes({
  lanes,
  lane,
  onLaneChange,
  onMove,
  onArchive,
  onBulkArchive,
  onOpenDetail,
  onOpenAnswer,
  answerController,
  id,
  previewRevealed,
}: MonitorLanesProps) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState<{ id: number; side: RevealSide } | null>(
    previewRevealed === undefined ? null : { id: previewRevealed, side: 'right' },
  );

  const changeLane = (next: MonitorSection) => {
    setRevealed(null);
    onLaneChange(next);
  };
  const swipe = useLaneSwipe(viewport, { lane, onLaneChange: changeLane, disabled: false });

  // A tap anywhere outside the card that shows its archive button closes it.
  useEffect(() => {
    if (revealed === null) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(`[data-swipe-card="${revealed.id}"]`))
        setRevealed(null);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [revealed]);

  const track =
    swipe.offset === null
      ? { transform: `translateX(${-laneIndex(lane) * 100}%)` }
      : { transform: `translateX(${swipe.offset}px)`, transition: 'none' };

  return (
    <div ref={viewport} id={id} className="monitor-lanes" {...swipe.handlers}>
      <div className="monitor-lanes__track" style={track}>
        {LANES.map((name) => {
          const items = lanes[name];
          return (
            <section
              key={name}
              className="monitor-lane"
              role="tabpanel"
              aria-labelledby={`lane-tab-${name}`}
              data-lane={name}
              inert={name !== lane}
            >
              {name === 'done' && (
                // The tab above already names the lane and its count; the bar holds only the action.
                <div className="monitor-lane__bar">
                  <Button
                    type="button"
                    variant="outline"
                    size="l"
                    disabled={items.length === 0}
                    onClick={onBulkArchive}
                  >
                    <IconLabel icon={ArchiveIcon}>{t('monitor.lanes.bulkArchive')}</IconLabel>
                  </Button>
                </div>
              )}
              <div className="monitor-lane__scroll">
                {items.length === 0 ? (
                  <p className="monitor-empty">{t(`monitor.empty.${name}`)}</p>
                ) : (
                  items.map((item) => (
                    <SwipeableCard
                      key={keyOf(item)}
                      taskId={item.task.id}
                      lane={name}
                      onMove={(target) => {
                        setRevealed(null);
                        onMove(item, target);
                      }}
                      inactive={name !== lane}
                      revealed={revealed?.id === item.task.id ? revealed.side : null}
                      onRevealChange={(side) =>
                        setRevealed(side === null ? null : { id: item.task.id, side })
                      }
                      onArchive={() => onArchive(item)}
                    >
                      <MonitorTask
                        item={item}
                        section={name}
                        onOpenDetail={onOpenDetail}
                        onOpenAnswer={onOpenAnswer}
                        answerController={answerController}
                      />
                    </SwipeableCard>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
