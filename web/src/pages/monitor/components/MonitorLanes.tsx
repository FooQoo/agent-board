import { type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonitorTask as MonitorTaskModel, MonitorViewProps } from '../contracts';
import { useLaneCarousel } from '../hooks/useLaneCarousel';
import { type PullState, REFRESHING_HEIGHT, usePullToRefresh } from '../hooks/usePullToRefresh';
import { LANES, type RevealSide } from '../model/lanes';
import type { MonitorSection } from './MonitorSectionHeader';
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
  id?: string;
  /** The tab bar: its marker follows the slide between lanes. */
  tabsRef?: RefObject<HTMLElement | null>;
  /** A story's still picture: this card has its left-swipe tiles showing. */
  previewRevealed?: number;
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
 * to show the lane on the left. Nothing here writes: every action is a callback.
 */
export function MonitorLanes({
  lanes,
  lane,
  onLaneChange,
  onMove,
  onArchive,
  onOpenDetail,
  onOpenAnswer,
  id,
  tabsRef,
  previewRevealed,
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
          return (
            <section
              key={name}
              className="monitor-lane"
              role="tabpanel"
              aria-labelledby={`lane-tab-${name}`}
              data-lane={name}
              inert={name !== lane}
            >
              <div className="monitor-lane__scroll">
                {name === lane && <PullIndicator state={shown.state} offset={shown.offset} />}
                {laneEmpty ? (
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
                      armed={armed === item.task.id}
                      onArm={() => {
                        setRevealed(null);
                        setArmed(item.task.id);
                      }}
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
