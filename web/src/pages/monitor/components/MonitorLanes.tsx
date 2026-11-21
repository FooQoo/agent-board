import { type RefObject, useEffect, useRef, useState } from 'react';
import { ArchiveXIcon, ListChecksIcon } from 'lucide-react';
import { Checkbox } from '@/shared/ui/checkbox';
import { BacklogBar } from '../../../features/backlog/BacklogBar';
import { useBacklogSelection } from '../../../features/backlog/useSelection';
import { useTranslation } from 'react-i18next';
import type { MonitorTask as MonitorTaskModel, MonitorViewProps } from '../contracts';
import { useLaneCarousel } from '../hooks/useLaneCarousel';
import { useLaneOverscroll } from '../hooks/useLaneOverscroll';
import { type PullState, REFRESHING_HEIGHT, usePullToRefresh } from '../hooks/usePullToRefresh';
import { LANES, type RevealSide } from '../model/lanes';
import type { MonitorSection } from './MonitorSectionHeader';
import { BulkArchiveTile } from './BulkArchiveTile';
import { MonitorTask } from './MonitorTask';
import { PullIndicator } from './PullIndicator';
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
  onOpenDetail?: MonitorViewProps['onOpenDetail'];
  onOpenAnswer?: (item: MonitorTaskModel) => void;
  /**
   * Swiping left on the last lane (Done) past its end, or the button after its cards, asks to
   * archive every done card; the screen opens the confirmation. While the swipe goes, the lane
   * follows the finger and uncovers an Archive all tile. Without it neither is offered.
   */
  onBulkArchive?: () => void;
  /**
   * The Backlog cards were picked and sent to Todo. Returns whether the send started without a
   * confirmation, which ends the selection mode. Without it the Backlog lane offers no selection.
   */
  onSend?: (ids: number[]) => boolean;
  sendBusy?: boolean;
  id?: string;
  /** The tab bar: its marker follows the slide between lanes. */
  tabsRef?: RefObject<HTMLElement | null>;
  /** A story's still picture: this card has its left-swipe tiles showing. */
  previewRevealed?: number;
  /** A story's still picture: the Done lane is dragged left this far (px), showing the tile. */
  previewBulkDrag?: number;
  /** Pulling a lane down from its top refreshes; without this the lanes cannot be pulled. */
  onRefresh?: () => void;
  /** The refresh the person asked for is running. */
  refreshing?: boolean;
  /** A story's still picture: the lane on screen shows this pull state. */
  previewPull?: Exclude<PullState, 'idle'>;
}

const keyOf = (item: MonitorTaskModel) => `${item.projectId}:${item.task.id}`;

/**
 * The phone monitor's lanes: one lane on screen, the other two beside it in a carousel. Tabs and a
 * sideways swipe anywhere move it. A card held for a moment is chosen and shows a focus
 * ring; a later swipe on it slides it left to show the lane on the right and the archive, or right
 * to show the lane on the left. A swipe to the left past the Done lane asks for the bulk archive, and the lane follows the finger to show an Archive all tile. Nothing here writes: every action is a callback.
 */
export function MonitorLanes({
  lanes,
  lane,
  onLaneChange,
  onMove,
  onArchive,
  onOpenDetail,
  onOpenAnswer,
  onBulkArchive,
  onSend,
  sendBusy = false,
  id,
  tabsRef,
  previewRevealed,
  previewBulkDrag,
  onRefresh,
  refreshing,
  previewPull,
}: MonitorLanesProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState<{ id: number; side: RevealSide } | null>(
    previewRevealed === undefined ? null : { id: previewRevealed, side: 'right' },
  );

  // The card a hold chose: it shows a focus ring, and a sideways swipe on it opens its tiles.
  const [armed, setArmed] = useState<number | null>(previewRevealed ?? null);

  const selection = useBacklogSelection(lanes.backlog.map((item) => item.task.id));
  const canSelect = onSend !== undefined && lanes.backlog.length > 0;
  const send = (ids: number[]) => {
    if (onSend?.(ids)) selection.leave();
  };

  const changeLane = (next: MonitorSection) => {
    setRevealed(null);
    setArmed(null);
    onLaneChange(next);
  };
  const carousel = useLaneCarousel(lane, changeLane, tabsRef);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewport = (node: HTMLDivElement | null) => {
    viewportRef.current = node;
    carousel(node);
  };
  const last = LANES[LANES.length - 1];
  const canBulk = onBulkArchive !== undefined && lanes.done.length > 0;
  const doneRef = useRef<HTMLElement | null>(null);
  const bulk = useLaneOverscroll(doneRef, lane === last && canBulk, () => onBulkArchive?.());
  const bulkOffset = previewBulkDrag === undefined ? bulk.offset : -previewBulkDrag;
  const pull = usePullToRefresh({ container: viewportRef, lane, onRefresh, refreshing });
  const shown =
    previewPull === undefined
      ? pull
      : { state: previewPull, offset: previewPull === 'refreshing' ? REFRESHING_HEIGHT : 40 };

  // A tap anywhere outside the chosen card lets it go and closes its tiles.
  useEffect(() => {
    if (armed === null) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(`[data-swipe-card="${armed}"]`)) {
        setArmed(null);
        setRevealed(null);
      }
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [armed]);

  return (
    <div ref={viewport} id={id} className="monitor-lanes">
      <div className="monitor-lanes__track">
        {LANES.map((name) => {
          const items = lanes[name];
          const laneEmpty = items.length === 0;
          const isLast = name === last;
          return (
            <section
              key={name}
              ref={isLast ? doneRef : undefined}
              {...(isLast ? bulk.handlers : {})}
              onClickCapture={isLast ? bulk.onClickCapture : undefined}
              className="monitor-lane"
              role="tabpanel"
              aria-labelledby={`lane-tab-${name}`}
              data-lane={name}
              inert={name !== lane}
            >
              <div
                className="monitor-lane__scroll"
                data-dragging={(isLast && bulk.dragging) || undefined}
                style={isLast ? { transform: `translate3d(${bulkOffset}px, 0, 0)` } : undefined}
              >
                {name === lane && <PullIndicator state={shown.state} offset={shown.offset} />}
                {laneEmpty ? (
                  <p className="monitor-empty">{t(`monitor.empty.${name}`)}</p>
                ) : name === 'backlog' && selection.selecting ? (
                  items.map((item) => (
                    <div key={keyOf(item)} className="monitor-pick-row">
                      <Checkbox
                        className="monitor-pick-row__check"
                        checked={selection.picked.includes(item.task.id)}
                        aria-label={t('backlog.selectCard', { id: item.task.id })}
                        onCheckedChange={() => selection.toggle(item.task.id)}
                      />
                      {/* A tap on the card picks it; the details are not opened while picking. */}
                      <div
                        className="monitor-pick-row__card"
                        onClickCapture={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          selection.toggle(item.task.id);
                        }}
                      >
                        <MonitorTask item={item} section={name} />
                      </div>
                    </div>
                  ))
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
                      armed={armed === item.task.id}
                      onArm={() => {
                        setRevealed(null);
                        setArmed(item.task.id);
                      }}
                      onRevealChange={(side) =>
                        setRevealed(side === null ? null : { id: item.task.id, side })
                      }
                      onArchive={() => onArchive(item)}
                      onSelect={
                        canSelect
                          ? () => {
                              setRevealed(null);
                              setArmed(null);
                              selection.enter();
                              selection.toggle(item.task.id);
                            }
                          : undefined
                      }
                    >
                      <MonitorTask
                        item={item}
                        section={name}
                        onOpenDetail={onOpenDetail}
                        onOpenAnswer={onOpenAnswer}
                      />
                    </SwipeableCard>
                  ))
                )}
                {name === 'backlog' && canSelect && !selection.selecting && (
                  <button
                    type="button"
                    className="monitor-lane__bulk"
                    data-lane-ignore=""
                    onClick={selection.enter}
                  >
                    <ListChecksIcon aria-hidden="true" />
                    {t('backlog.selectCards')}
                  </button>
                )}
                {name === 'backlog' && selection.selecting && (
                  <BacklogBar
                    variant="phone"
                    count={selection.picked.length}
                    busy={sendBusy}
                    onCancel={selection.leave}
                    onSend={() => send(selection.picked)}
                  />
                )}
                {name === 'done' && canBulk && (
                  <button
                    type="button"
                    className="monitor-lane__bulk"
                    data-lane-ignore=""
                    onClick={onBulkArchive}
                  >
                    <ArchiveXIcon aria-hidden="true" />
                    {t('monitor.lanes.bulkArchive')}
                  </button>
                )}
              </div>
              {isLast && canBulk && <BulkArchiveTile offset={bulkOffset} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}
