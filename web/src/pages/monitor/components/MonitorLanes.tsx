import { ArchiveIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { IconLabel } from '@/shared/ui/icon-label';
import type { MonitorTask as MonitorTaskModel, MonitorViewProps } from '../contracts';
import { type Lift, useLaneLift } from '../hooks/useLaneLift';
import { useLaneSwipe } from '../hooks/useLaneSwipe';
import { LANES, laneIndex } from '../model/lanes';
import { LaneEdges } from './LaneEdges';
import { MonitorSectionHeader, type MonitorSection } from './MonitorSectionHeader';
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
  /** A card was dropped into another lane: the screen asks for the move confirmation. */
  onMove: (item: MonitorTaskModel, target: MonitorSection) => void;
  /** The archive button of a card was tapped: the screen asks for the archive confirmation. */
  onArchive: (item: MonitorTaskModel) => void;
  /** 「まとめてアーカイブ」 of the done lane was tapped: the screen asks for the confirmation. */
  onBulkArchive: () => void;
  onOpenDetail?: MonitorViewProps['onOpenDetail'];
  onOpenAnswer?: (item: MonitorTaskModel) => void;
  answerController?: MonitorViewProps['answerController'];
  id?: string;
  /** A story's still picture: this card has its archive button showing. */
  previewRevealed?: number;
  /** A story's still picture: this card is held at the pointer's position (viewport px). */
  previewLift?: { taskId: number; x: number; y: number };
}

/** A story's still picture of a lift: the card named by `preview`, held at its position. */
function previewLiftOf(lanes: LaneItems, preview: MonitorLanesProps['previewLift']): Lift | null {
  if (!preview) return null;
  for (const source of LANES) {
    const item = lanes[source].find((candidate) => candidate.task.id === preview.taskId);
    if (item)
      return {
        item,
        source,
        pointer: { x: preview.x, y: preview.y },
        grab: { x: 120, y: 28 },
        width: null,
        edge: preview.x > 195 ? 'right' : 'left',
        frozen: true,
      };
  }
  return null;
}

const keyOf = (item: MonitorTaskModel) => `${item.projectId}:${item.task.id}`;

/**
 * The phone monitor's lanes: one lane on screen, the other two beside it on a track. Tabs and a
 * sideways swipe on empty space move the track. A card slides left to show an archive button, and
 * a card held for 100 ms lifts and can be carried to the edge of the screen, which moves to the
 * neighbouring lane; letting go there asks to move it. Nothing here writes: every action is a callback.
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
  previewLift,
}: MonitorLanesProps) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState<number | null>(previewRevealed ?? null);

  const [initialLift] = useState<Lift | null>(() => previewLiftOf(lanes, previewLift));

  const changeLane = (next: MonitorSection) => {
    setRevealed(null);
    onLaneChange(next);
  };
  const swipe = useLaneSwipe(viewport, { lane, onLaneChange: changeLane, disabled: false });
  const carried = useLaneLift(viewport, {
    lane,
    onLaneChange: changeLane,
    onMove,
    initial: initialLift,
  });

  // A tap anywhere outside the card that shows its archive button closes it.
  useEffect(() => {
    if (revealed === null) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(`[data-swipe-card="${revealed}"]`)) setRevealed(null);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [revealed]);

  const ghostWidth = carried.lift?.width ? `${carried.lift.width}px` : 'calc(100% - 16px)';
  const track =
    swipe.offset === null
      ? { transform: `translateX(${-laneIndex(lane) * 100}%)` }
      : { transform: `translateX(${swipe.offset}px)`, transition: 'none' };

  return (
    <div
      ref={viewport}
      id={id}
      className="monitor-lanes"
      data-lifting={carried.lift ? '' : undefined}
      {...swipe.handlers}
    >
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
                <div className="monitor-lane__bar">
                  <MonitorSectionHeader section="done" count={items.length} />
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
                      revealed={revealed === item.task.id}
                      onRevealChange={(open) => setRevealed(open ? item.task.id : null)}
                      onArchive={() => onArchive(item)}
                      onLiftStart={(point, grab, rect) => {
                        setRevealed(null);
                        carried.start(item, name, point, grab, rect.width);
                      }}
                      onLiftMove={carried.move}
                      onLiftEnd={(_point, cancelled) => carried.end(cancelled)}
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
      {carried.lift && (
        <>
          <LaneEdges lane={lane} active={carried.lift.edge} />
          <div
            className="lane-ghost"
            aria-hidden="true"
            style={{
              // The card follows the finger but stays on screen at the edges.
              left: `clamp(4px, ${carried.lift.pointer.x - carried.lift.grab.x}px, calc(100% - ${ghostWidth} - 4px))`,
              top: carried.lift.pointer.y - carried.lift.grab.y,
              width: ghostWidth,
            }}
          >
            <MonitorTask item={carried.lift.item} section={carried.lift.source} />
          </div>
        </>
      )}
    </div>
  );
}
