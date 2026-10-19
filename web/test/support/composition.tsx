import type { ReactNode } from 'react';
import { EpicBadge } from '../../src/features/epics/label/EpicBadge';
import { EpicLabel } from '../../src/features/epics/label/EpicLabel';
import { epicInk } from '../../src/features/epics/model/epic';
import { TaskProgressRow } from '../../src/features/tasks/card/TaskProgressRow';
import type { ProgressTaskRenderer } from '../../src/features/epics/editor/EpicProgressList';
import type { Epic, EpicRef } from '../../src/shared/api/contracts';

/** The slots the board's pages and dialogs fill in, for tests that render a part on its own. */
export const renderEpicBadge = (epic: Epic, className: string): ReactNode => (
  <EpicBadge epic={epic} className={className} />
);

export const renderEpicLabel =
  (onOpenEpic: (epicId: string) => void = () => {}) =>
  (epic: EpicRef): ReactNode => (
    <EpicLabel
      epic={epic}
      className="card__epic"
      stopPropagation
      onClick={() => onOpenEpic(epic.id)}
    />
  );

export const renderEpicChip = (epic: EpicRef): ReactNode => (
  <span
    className="editor__epic-chip"
    style={{ background: epic.color, color: epicInk(epic.color) }}
    title={epic.name}
  >
    {epic.id}
  </span>
);

export const renderProgressTask: ProgressTaskRenderer = (task, row) => (
  <TaskProgressRow task={task} {...row} />
);
