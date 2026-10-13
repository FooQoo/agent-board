import { useTranslation } from 'react-i18next';
import type { Epic, ProjectId } from '../../types';
import { MarkdownSections } from '../markdown/MarkdownSections';
import { DetailAttachments } from './DetailAttachments';

/** What the epic tab of a card can show: nothing, the epic, or why the epic is not there. */
export type EpicTabStatus = 'none' | 'loading' | 'failed' | 'ready';

/**
 * The epic a card belongs to, read-only: its plan and its images. Its conditions are in the conditions tab. A card without an epic, an epic still loading, and an epic that could not be read
 * each say so, and a failure can be tried again.
 */
export function EpicTabView({
  projectId,
  epic,
  status,
  onRetry,
}: {
  projectId: ProjectId;
  epic: Epic | null;
  status: EpicTabStatus;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (status === 'none') return <p className="detail__empty">{t('detail.epicNone')}</p>;
  if (status === 'loading') return <p className="detail__empty">{t('detail.epicLoading')}</p>;
  if (status === 'failed' || epic === null) {
    return (
      <div className="detail__empty" role="alert">
        <p>{t('detail.epicFailed')}</p>
        {onRetry && (
          <button type="button" className="detail__retry" onClick={onRetry}>
            {t('detail.epicRetry')}
          </button>
        )}
      </div>
    );
  }
  const attachmentUrl = (id: string) =>
    `/api/projects/${projectId}/epics/${encodeURIComponent(epic.id)}/attachments/${encodeURIComponent(id)}`;
  return (
    <>
      <MarkdownSections
        source={epic.body}
        resolveAttachment={(id) =>
          epic.attachments.some((item) => item.id === id) ? attachmentUrl(id) : null
        }
      />
      <DetailAttachments
        projectId={projectId}
        cardId={0}
        attachments={epic.attachments}
        attachmentUrl={attachmentUrl}
      />
    </>
  );
}
