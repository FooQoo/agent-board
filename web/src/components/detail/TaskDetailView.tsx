import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { historyItems } from '../../lib/history';
import { stateLabel } from '../../lib/format';
import type { Task, Epic, Problem, ProjectId } from '../../types';
import { AssigneeLabel } from '../AssigneeLabel';
import { HistoryTimeline } from '../HistoryTimeline';
import { StatusLabel } from '../StatusLabel';
import { BodyDocumentView } from './BodyDocumentView';
import { type DetailTab, DetailTabs, panelId, tabId } from './DetailTabs';
import { DraftStatus } from './DraftStatus';
import { EpicTabView, type EpicTabStatus } from './EpicTabView';
import { AcceptanceTabView } from './AcceptanceTabView';
import { DetailHeader } from './DetailHeader';
import '../../styles/detail.css';

export interface TaskDetailViewProps {
  projectId: ProjectId;
  task: Task;
  tab: DetailTab;
  onTabChange(tab: DetailTab): void;
  onClose(): void;
  attachmentUrl?: (id: string) => string;
  evidenceUrl?: (id: string) => string;
  problems?: readonly Problem[];
  /** The epics of the project, when they are read. Undefined while they load. */
  epics?: readonly Epic[];
  /** The epics could not be read: the epic tab offers to try again. */
  epicsFailed?: boolean;
  onRetryEpics?: () => void;
  statusLabels?: 'pc' | 'monitor';
  ownerName?: string;
  readOnlyDraft?: boolean;
  toolbar?: ReactNode;
  children?: ReactNode;
}

/** Side-effect-free shared card display. Optional children are PC-only operations supplied by its host. */
export function TaskDetailView({
  projectId,
  task,
  tab,
  onTabChange,
  onClose,
  attachmentUrl = (id) => `/api/projects/${projectId}/tasks/${task.id}/attachments/${id}`,
  evidenceUrl,
  problems = [],
  epics,
  epicsFailed = false,
  onRetryEpics,
  statusLabels = 'pc',
  ownerName,
  readOnlyDraft = true,
  toolbar,
  children,
}: TaskDetailViewProps) {
  const { t } = useTranslation();
  const idBase = useId();
  const ownProblems = problems.filter((problem) =>
    problem.file.startsWith(`projects/${projectId}/tasks/${task.id}/`),
  );
  // The card's epic is looked up in the project's epics; a card without one has no epic tab content.
  const epic = task.epic ? (epics?.find((item) => item.id === task.epic?.id) ?? null) : null;
  const epicStatus: EpicTabStatus = !task.epic
    ? 'none'
    : epic
      ? 'ready'
      : epics === undefined && !epicsFailed
        ? 'loading'
        : 'failed';
  return (
    <aside className="detail detail-view" aria-label={t('detail.title')}>
      <DetailHeader
        identity={
          <>
            {ownerName && <span className="detail__owner">{ownerName} · </span>}#{task.id}
          </>
        }
        toolbar={toolbar}
        onClose={onClose}
      />
      <h2 className="detail__title" id="card-detail-title">
        {task.title}
      </h2>
      <div className="detail__meta">
        <StatusLabel kind="card" status={task.taskStatus} monitor={statusLabels === 'monitor'} />
        {stateLabel(task) !== null && (
          <StatusLabel
            kind="agent"
            status={task.agentStatus}
            monitor={statusLabels === 'monitor'}
          />
        )}
        <AssigneeLabel assignee={task.assignee} />
        <span className="detail__assignee" aria-hidden="true">
          {t(`assignee.${task.assignee}`)}
        </span>
      </div>
      {readOnlyDraft && task.isDraft && <DraftStatus />}
      {children}
      <DetailTabs
        idBase={idBase}
        tab={tab}
        historyCount={historyItems(task.history).length}
        onChange={onTabChange}
      />
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'description')}
        aria-labelledby={tabId(idBase, 'description')}
        hidden={tab !== 'description'}
      >
        <BodyDocumentView
          body={task.body}
          acceptanceError={task.acceptanceError}
          problems={ownProblems}
          attachments={task.attachments ?? []}
          evidence={task.evidence ?? []}
          projectId={projectId}
          taskId={task.id}
          attachmentUrl={attachmentUrl}
          evidenceUrl={evidenceUrl}
        />
      </div>
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'epic')}
        aria-labelledby={tabId(idBase, 'epic')}
        hidden={tab !== 'epic'}
      >
        <EpicTabView projectId={projectId} epic={epic} status={epicStatus} onRetry={onRetryEpics} />
      </div>
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'history')}
        aria-labelledby={tabId(idBase, 'history')}
        hidden={tab !== 'history'}
      >
        <HistoryTimeline events={task.history} />
      </div>
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'acceptance')}
        aria-labelledby={tabId(idBase, 'acceptance')}
        hidden={tab !== 'acceptance'}
      >
        <AcceptanceTabView task={task} />
      </div>
    </aside>
  );
}
