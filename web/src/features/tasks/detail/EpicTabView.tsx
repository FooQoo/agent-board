import { useTranslation } from 'react-i18next';
import type { EpicRef, ProjectId } from '../../../shared/api/contracts';
import type { SectionSnapshot } from '../../../shared/data/core';
import { DetailAttachments } from './DetailAttachments';
import { DetailSectionView } from './DetailSection';
import { DocumentBlocks } from './BodyDocumentView';

/** What the epic tab of a card can show: nothing, the epic, or why the epic is not there. */
export type EpicTabStatus = 'none' | 'loading' | 'failed' | 'ready';

/**
 * The epic a card belongs to, read-only: its epic details and its images. Conditions written in the epic details are ordinary Markdown. A card without an epic, an epic still loading, and an epic that could not be read
 * each say so, and a failure can be tried again. The document is read the first time the tab is shown.
 */
export function EpicTabView({
  projectId,
  epic,
  status,
  document,
  onRetry,
  onRetryDocument,
  scrollParent = null,
}: {
  projectId: ProjectId;
  epic: EpicRef | null;
  status: EpicTabStatus;
  /** The epic's `document` section; read once the tab is shown. */
  document: SectionSnapshot<'document'>;
  /** Reads the project's epics again. */
  onRetry?: () => void;
  /** Reads the epic's document again. */
  onRetryDocument?: () => void;
  scrollParent?: HTMLElement | null;
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
    <DetailSectionView snapshot={document} onRetry={() => onRetryDocument?.()}>
      {(data, arriving) => (
        <>
          <DocumentBlocks
            document={data}
            arriving={arriving}
            attachmentUrl={attachmentUrl}
            scrollParent={scrollParent}
          />
          {!arriving && (
            <DetailAttachments
              projectId={projectId}
              taskId={0}
              attachments={[...(data.attachments ?? [])]}
              attachmentUrl={attachmentUrl}
            />
          )}
        </>
      )}
    </DetailSectionView>
  );
}
