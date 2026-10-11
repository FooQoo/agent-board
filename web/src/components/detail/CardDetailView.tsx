import { XIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { historyItems } from '../../lib/history';
import { stateLabel } from '../../lib/format';
import type { Card, Problem, ProjectId } from '../../types';
import { AssigneeLabel } from '../AssigneeLabel';
import { AcceptanceView } from '../acceptance/AcceptanceView';
import { HistoryTimeline } from '../HistoryTimeline';
import { StatusLabel } from '../StatusLabel';
import { MarkdownSections } from '../markdown/MarkdownSections';
import { DecisionRequestContent } from './DecisionRequestContent';
import { DetailAttachments } from './DetailAttachments';
import { DetailEvidence } from './DetailEvidence';
import { type DetailTab, DetailTabs, panelId, tabId } from './DetailTabs';
import { DraftStatus } from './DraftStatus';
import { ProblemNotice } from './ProblemNotice';
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
  statusLabels = 'pc',
  ownerName,
  readOnlyRequest = true,
  readOnlyDraft = true,
  toolbar,
  children,
}: CardDetailViewProps) {
  const { t } = useTranslation();
  const idBase = useId();
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
        <ProblemNotice
          problems={problems.filter((problem) =>
            problem.file.startsWith(`projects/${projectId}/tasks/${card.id}/`),
          )}
        />
        {card.acceptanceError && (
          <div className="acceptance-unreadable" role="status">
            <p className="acceptance-unreadable__title">{t('acceptance.unreadableTitle')}</p>
            <p className="acceptance-unreadable__note">{t('acceptance.unreadableNote')}</p>
          </div>
        )}
        <AcceptanceView items={card.acceptanceError ? [] : card.acceptance} />
        <MarkdownSections
          source={card.body}
          resolveAttachment={(id) =>
            card.attachments.some((attachment) => attachment.id === id) ? attachmentUrl(id) : null
          }
        />
        <DetailAttachments
          projectId={projectId}
          cardId={card.id}
          attachments={card.attachments ?? []}
          attachmentUrl={attachmentUrl}
        />
        <DetailEvidence evidence={card.evidence ?? []} evidenceUrl={evidenceUrl} />
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
    </aside>
  );
}
