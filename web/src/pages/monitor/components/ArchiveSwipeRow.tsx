import { RotateCcwIcon } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { revealOffset, revealProgress } from '@/shared/lib/gesture/cardReveal';
import { useCardGesture } from '@/shared/lib/gesture/useCardGesture';
import type { ArchivedTask } from '../../../features/tasks/api/read';
import type { ProjectId } from '../../../shared/api/contracts';
import type { MonitorTask as MonitorTaskModel } from '../contracts';
import { actionsWidth } from '../model/lanes';
import { MonitorTask } from './MonitorTask';
import './monitor-lanes.css';

/** One Restore tile on the right, as wide as a lane card's tiles. */
const RESTORE_WIDTH = actionsWidth(1);

export interface ArchiveSwipeRowProps {
  task: ArchivedTask;
  projectId: ProjectId;
  projectName: string;
  /** The Restore tile is showing. */
  revealed: boolean;
  /** The row is being restored: the tile cannot be pressed twice. */
  busy: boolean;
  onRevealChange: (revealed: boolean) => void;
  onRestore: () => void;
}

/**
 * One archived task, drawn with the card the lanes use. A swipe to the left uncovers the Restore
 * tile on the right at once, with no choosing first (nothing else in the drawer moves sideways). A tap on an
 * open row closes the tile; a tap on a closed one does nothing, since an archived task has no
 * detail to open. Under the card, the lane it returns to and the date it was archived.
 */
export function ArchiveSwipeRow({
  task,
  projectId,
  projectName,
  revealed,
  busy,
  onRevealChange,
  onRestore,
}: ArchiveSwipeRowProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  // A reveal asked for with the keyboard moves focus to Restore once its tile is on screen.
  const focusRestore = useRef(false);
  useEffect(() => {
    if (revealed && focusRestore.current) restoreRef.current?.focus();
    focusRestore.current = false;
  }, [revealed]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target === ref.current && ['ArrowLeft', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      focusRestore.current = true;
      onRevealChange(true);
    } else if (event.key === 'ArrowRight' && revealed) {
      // Escape is left to the drawer, which it closes.
      event.preventDefault();
      onRevealChange(false);
      ref.current?.focus();
    }
  };
  const side = revealed ? 'right' : null;
  const { drag, consumesClick, handlers } = useCardGesture(ref, {
    revealed: side,
    onRevealChange: (next) => onRevealChange(next === 'right'),
    armed: true,
    onArm: () => {},
    leftWidth: 0,
    rightWidth: RESTORE_WIDTH,
  });
  const offset = drag ?? revealOffset(side, 0, RESTORE_WIDTH);
  const shown = offset < 0;
  // The card never reads more than a list card shows; an archived task is one of those.
  const item = { projectId, projectName, task } as MonitorTaskModel;
  return (
    <div role="listitem" className="archive-row" data-archive-row={task.id}>
      <div
        ref={ref}
        className="swipe-card"
        // Without a finger the card is the way in: focus it, then Enter or the left arrow opens Restore.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the card is the keyboard's way to Restore; it has key handling
        tabIndex={0}
        role="group"
        aria-label={`#${task.id} ${task.title}`}
        aria-keyshortcuts="ArrowLeft Enter"
        onKeyDown={onKeyDown}
        data-swipe-card={task.id}
        data-revealed={revealed ? 'right' : undefined}
        data-dragging={drag !== null || undefined}
        {...handlers}
        onClickCapture={(event) => {
          // The click that ends a swipe is not a tap; a tap on an open row closes it.
          if ((event.target as Element).closest('[data-swipe-action]')) return;
          if (consumesClick() || revealed) {
            event.preventDefault();
            event.stopPropagation();
            if (revealed && !consumesClick()) onRevealChange(false);
          }
        }}
      >
        <div
          className="swipe-card__actions"
          data-side="right"
          data-revealed={shown || undefined}
          style={
            {
              width: `${shown ? Math.min(RESTORE_WIDTH, Math.abs(offset)) : 0}px`,
              '--reveal': shown ? revealProgress(offset, RESTORE_WIDTH) : 0,
            } as CSSProperties
          }
        >
          <button
            ref={restoreRef}
            type="button"
            data-swipe-action
            className="swipe-card__tile"
            tabIndex={revealed ? 0 : -1}
            aria-hidden={!revealed}
            aria-label={t('archive.restoreTask', { id: task.id })}
            disabled={busy}
            onClick={onRestore}
          >
            <RotateCcwIcon aria-hidden="true" />
          </button>
        </div>
        <div
          className="swipe-card__body"
          style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
        >
          <MonitorTask item={item} section={task.taskStatus} />
        </div>
      </div>
      <p className="archive-row__meta">
        <span>{t('archive.returnsTo', { lane: t(`monitor.status.${task.taskStatus}`) })}</span>
        <time dateTime={task.archivedAt ?? undefined}>
          {t('archive.archivedOn', { date: task.archivedAt?.slice(0, 10) ?? '—' })}
        </time>
      </p>
    </div>
  );
}
