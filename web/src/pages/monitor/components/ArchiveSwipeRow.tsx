import { RotateCcwIcon } from 'lucide-react';
import { type CSSProperties, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCardGesture } from '@/shared/lib/gesture/useCardGesture';
import { revealOffset, revealProgress } from '@/shared/lib/gesture/cardReveal';
import type { ArchivedTask } from '../../../features/tasks/api/read';
import { AssigneeLabel } from '../../../features/tasks/assignee/AssigneeLabel';
import { EpicBadge } from '../../../features/epics/label/EpicBadge';
import './archive-sheet.css';

/** The width (px) of the Restore tile a right swipe uncovers. */
const RESTORE_TILE_WIDTH = 88;

export interface ArchiveSwipeRowProps {
  task: ArchivedTask;
  /** The row a tap or a hold chose: only then does a right swipe slide it. */
  armed: boolean;
  /** The Restore tile is showing. */
  revealed: boolean;
  /** The row is being restored: the tile cannot be pressed twice. */
  busy: boolean;
  onArm: () => void;
  onRevealChange: (revealed: boolean) => void;
  onRestore: () => void;
}

/**
 * One archived task. A tap chooses the row (a focus ring shows); a swipe to the right on a chosen
 * row slides it and uncovers a Restore tile on its left. A tap on an open row closes the tile.
 * The task returns to the lane it was archived from.
 */
export function ArchiveSwipeRow({
  task,
  armed,
  revealed,
  busy,
  onArm,
  onRevealChange,
  onRestore,
}: ArchiveSwipeRowProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const side = revealed ? 'left' : null;
  const { drag, consumesClick, handlers } = useCardGesture(ref, {
    revealed: side,
    onRevealChange: (next) => onRevealChange(next === 'left'),
    armed,
    onArm,
    leftWidth: RESTORE_TILE_WIDTH,
    rightWidth: 0,
  });
  const offset = drag ?? revealOffset(side, RESTORE_TILE_WIDTH, 0);
  const shown = offset > 0;
  const lane = t(`monitor.status.${task.taskStatus}`);
  return (
    <div
      ref={ref}
      className="archive-swipe"
      role="listitem"
      data-archive-row={task.id}
      data-revealed={revealed || undefined}
      data-armed={armed || undefined}
      data-dragging={drag !== null || undefined}
      {...handlers}
      onClickCapture={(event) => {
        // The click that ends a swipe is not a tap; a tap on an open row closes it.
        if ((event.target as Element).closest('[data-swipe-action]')) return;
        if (consumesClick()) {
          event.preventDefault();
          event.stopPropagation();
        } else if (revealed) {
          event.preventDefault();
          event.stopPropagation();
          onRevealChange(false);
        }
      }}
    >
      <div
        className="archive-swipe__actions"
        data-revealed={shown || undefined}
        style={
          {
            width: `${shown ? Math.min(RESTORE_TILE_WIDTH, offset) : 0}px`,
            '--reveal': shown ? revealProgress(offset, RESTORE_TILE_WIDTH) : 0,
          } as CSSProperties
        }
      >
        <button
          type="button"
          data-swipe-action
          className="archive-swipe__restore"
          tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed}
          aria-label={t('archive.restoreTask', { id: task.id })}
          disabled={busy}
          onClick={onRestore}
        >
          <RotateCcwIcon aria-hidden="true" />
          <span>{t('archive.restore')}</span>
        </button>
      </div>
      <button
        type="button"
        className="archive-swipe__body"
        aria-pressed={armed}
        style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
        onClick={onArm}
      >
        <span className="archive-swipe__id">#{task.id}</span>
        <span className="archive-swipe__title">{task.title}</span>
        <AssigneeLabel assignee={task.assignee} />
        <span className="archive-swipe__meta">
          <span>{t('archive.returnsTo', { lane })}</span>
          <time dateTime={task.archivedAt ?? undefined}>
            {task.archivedAt?.slice(0, 10) ?? '—'}
          </time>
          {task.epic && <EpicBadge epic={task.epic} className="archive-swipe__epic" />}
        </span>
      </button>
    </div>
  );
}
