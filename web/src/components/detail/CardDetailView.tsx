import { XIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { historyItems } from '../../lib/history';
import { stateLabel } from '../../lib/format';
import type { Card, Epic, Problem, ProjectId } from '../../types';
import { AssigneeLabel } from '../AssigneeLabel';
import { HistoryTimeline } from '../HistoryTimeline';
import { StatusLabel } from '../StatusLabel';
import { BodyDocumentView } from './BodyDocumentView';
import { DecisionRequestContent } from './DecisionRequestContent';
import { type DetailTab, DetailTabs, panelId, tabId } from './DetailTabs';
import { DraftStatus } from './DraftStatus';
import { EpicTabView, type EpicTabStatus } from './EpicTabView';
import { ConditionsDock } from '../acceptance/ConditionsDock';
import '../../styles/detail.css';

export interface CardDetailViewProps {
  projectId: ProjectId;
  card: Card;
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
  readOnlyRequest?: boolean;
  readOnlyDraft?: boolean;
  toolbar?: ReactNode;
  children?: ReactNode;
}

/** Side-effect-free shared card display. Optional children are PC-only operations supplied by its host. */
export function CardDetailView({
  projectId,
  card,
  tab,
  onTabChange,
  onClose,
  attachmentUrl = (id) => `/api/projects/${projectId}/cards/${card.id}/attachments/${id}`,
  evidenceUrl,
  problems = [],
  epics,
  epicsFailed = false,
  onRetryEpics,
  statusLabels = 'pc',
  ownerName,
  readOnlyRequest = true,
  readOnlyDraft = true,
  toolbar,
  children,
}: CardDetailViewProps) {
  const { t } = useTranslation();
  const idBase = useId();
  const ownProblems = problems.filter((problem) =>
    problem.file.startsWith(`projects/${projectId}/tasks/${card.id}/`),
  );
  // The card's epic is looked up in the project's epics; a card without one has no epic tab content.
  const epic = card.epic ? (epics?.find((item) => item.id === card.epic?.id) ?? null) : null;
  const epicStatus: EpicTabStatus = !card.epic
    ? 'none'
    : epic
      ? 'ready'
      : epics === undefined && !epicsFailed
        ? 'loading'
        : 'failed';
  return (
    <aside className="detail detail-view" aria-label={t('detail.title')}>
      <div className="detail__top">
        <span className="detail__id">
          {ownerName && <span className="detail__owner">{ownerName} · </span>}#{card.id}
        </span>
        <button
          type="button"
          className="detail__close"
          aria-label={t('detail.close')}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </button>
      </div>
      <h2 className="detail__title" id="card-detail-title">
        {card.title}
      </h2>
      <div className="detail__meta">
        <StatusLabel kind="card" status={card.cardStatus} monitor={statusLabels === 'monitor'} />
        {stateLabel(card) !== null && (
          <StatusLabel
            kind="agent"
            status={card.agentStatus}
            monitor={statusLabels === 'monitor'}
          />
        )}
        <AssigneeLabel assignee={card.assignee} />
        <span className="detail__assignee" aria-hidden="true">
          {t(`assignee.${card.assignee}`)}
        </span>
      </div>
      {readOnlyDraft && card.isDraft && <DraftStatus />}
      {readOnlyRequest && <DecisionRequestContent card={card} />}
      {children}
      <DetailTabs
        idBase={idBase}
        tab={tab}
        historyCount={historyItems(card.history).length}
        onChange={onTabChange}
      >
        {toolbar}
      </DetailTabs>
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'description')}
        aria-labelledby={tabId(idBase, 'description')}
        hidden={tab !== 'description'}
      >
        <BodyDocumentView
          body={card.body}
          acceptanceError={card.acceptanceError}
          problems={ownProblems}
          attachments={card.attachments ?? []}
          evidence={card.evidence ?? []}
          projectId={projectId}
          cardId={card.id}
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
        <HistoryTimeline events={card.history} />
      </div>
      {(tab === 'description'
        ? !card.acceptanceError
        : tab === 'epic' && epicStatus === 'ready') && (
        <div className="detail__dock">
          <ConditionsDock
            items={tab === 'epic' ? (epic?.acceptance ?? []) : card.acceptance}
            readOnly
          />
        </div>
      )}
    </aside>
  );
}
