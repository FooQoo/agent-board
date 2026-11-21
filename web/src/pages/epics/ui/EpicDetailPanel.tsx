import { PencilIcon, SendIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import '../../../shared/styles/backlog.css';
import { useEffect, useRef, useState } from 'react';
import { useEpicDetail } from '../../../shared/data/react';
import { useTranslation } from 'react-i18next';
import type { Epic, ProjectId } from '../../../shared/api/contracts';
import { WriteError } from '../../../shared/api/writeErrors';
import { noOperations, type OperationControls } from '../../../shared/lib/operations/operations';
import { EpicBadge } from '../../../features/epics/label/EpicBadge';
import { DraftBanner } from '../../../features/tasks/detail/DraftBanner';
import { DetailAttachments } from '../../../features/tasks/detail/DetailAttachments';
import { DocumentBlocks } from '../../../features/tasks/detail/BodyDocumentView';
import { DetailSectionView } from '../../../features/tasks/detail/DetailSection';
import { DetailHeader } from '../../../features/tasks/detail/DetailHeader';
import { ConfirmPanel } from '@/shared/ui/confirm-panel';
import '../../../features/tasks/detail/detail.css';
import '../epics.css';

export interface EpicDetailPanelProps {
  projectId: ProjectId;
  epic: Epic;
  /** Opens the existing epic editor. */
  onEdit: () => void;
  /** Deletes the epic; the server refuses while a task still names it. */
  onDelete: () => Promise<void>;
  /** Finalizes the draft epic (the "Finalize" button of the draft box); shown only for a draft. */
  onFinalize?: () => Promise<void>;
  operations?: OperationControls;
  onClose: () => void;
  /** How many cards of the epic wait in the Backlog. */
  backlogCount?: number;
  /** Sends them to Todo in one save; the app confirms a warning and shows the result. */
  onSendBacklog?: () => void;
  sendBusy?: boolean;
}

/** The detail column while no epic is selected: the same empty state the archive shows. */
export function EpicDetailPlaceholder() {
  const { t } = useTranslation();
  return (
    <aside className="detail detail--empty" aria-label={t('epics.detailTitle')}>
      <p className="detail__empty-message">{t('epics.detailPrompt')}</p>
    </aside>
  );
}

/** The read-only details of the selected epic: its label, name, details, and images, with edit, delete, and close. */
export function EpicDetailPanel({
  projectId,
  epic,
  onEdit,
  onDelete,
  onFinalize,
  operations = noOperations,
  onClose,
  backlogCount = 0,
  onSendBacklog,
  sendBusy,
}: EpicDetailPanelProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeFailed, setFinalizeFailed] = useState(false);
  const operation = useRef<number | null>(null);
  // A delete or finalize is on its way. A second press before the button re-renders as busy is ignored.
  const inFlight = useRef(false);
  const controls = useRef(operations);
  controls.current = operations;
  // The epic's text is its `document`, read when the epic is first shown and kept for later.
  const detail = useEpicDetail(projectId, epic.id);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const attachmentUrl = (id: string) =>
    `/api/projects/${projectId}/epics/${encodeURIComponent(epic.id)}/attachments/${encodeURIComponent(id)}`;

  useEffect(() => {
    if (!confirming) return;
    const id = controls.current.begin('delete', projectId);
    operation.current = id;
    return () => {
      controls.current.end(id);
      operation.current = null;
    };
  }, [confirming, projectId]);

  // A deleted epic leaves the board, which clears the selection and unmounts this panel; a refusal keeps the question open.
  const remove = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (operation.current !== null) controls.current.saveStarted(operation.current);
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
      setConfirming(false);
    } catch (cause) {
      if (operation.current !== null) controls.current.saveFailed(operation.current);
      setDeleteError(
        cause instanceof WriteError && cause.code === 'epic_in_use'
          ? t('epic.deleteInUse')
          : t('epic.deleteFailed'),
      );
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  };

  const finalize = async () => {
    if (onFinalize === undefined || inFlight.current) return;
    inFlight.current = true;
    setFinalizing(true);
    setFinalizeFailed(false);
    try {
      await onFinalize();
    } catch {
      setFinalizeFailed(true);
    } finally {
      inFlight.current = false;
      setFinalizing(false);
    }
  };

  return (
    <aside className="detail detail-view epic-detail" aria-label={t('epics.detailTitle')}>
      <DetailHeader
        identityClassName="epic-detail__tags"
        identity={
          <>
            <EpicBadge epic={epic} className="epic-detail__badge" icon={false} />
            {epic.draft !== null && <span className="card__draft">{t('draft.label')}</span>}
          </>
        }
        onClose={onClose}
        toolbar={
          <div className="detail__toolbar" role="toolbar" aria-label={t('epics.actions')}>
            <button
              type="button"
              className="detail__tool"
              aria-label={t('epics.edit')}
              title={t('epics.edit')}
              onClick={onEdit}
            >
              <PencilIcon aria-hidden="true" />
            </button>
            <button
              type="button"
              className="detail__tool detail__tool--delete"
              aria-label={t('epics.delete')}
              title={t('epics.delete')}
              onClick={() => {
                setDeleteError(null);
                setConfirming(true);
              }}
            >
              <Trash2Icon aria-hidden="true" />
            </button>
          </div>
        }
      />
      {confirming && (
        <ConfirmPanel
          title={t('epic.deleteTitle')}
          message={t('epic.deleteBody', { id: epic.id })}
          error={deleteError}
          confirmLabel={t('epic.deleteConfirm')}
          cancelLabel={t('epic.deleteCancel')}
          busy={deleting}
          focusOnMount
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
      <h2 className="detail__title" id="epic-detail-title">
        {epic.name}
      </h2>
      {backlogCount > 0 && onSendBacklog && (
        <section
          className="backlog-detail backlog-detail--epic"
          aria-label={t('backlog.detail.heading')}
        >
          <p className="backlog-detail__text">{t('backlog.detail.text')}</p>
          <Button
            type="button"
            size="s"
            className="detail-btn"
            disabled={sendBusy}
            aria-label={t('backlog.epic.sendLabel', { count: backlogCount })}
            onClick={onSendBacklog}
          >
            <SendIcon aria-hidden="true" />
            {t('backlog.epic.send', { count: backlogCount })}
          </Button>
        </section>
      )}
      {epic.draft !== null && onFinalize !== undefined && (
        <DraftBanner
          busy={finalizing}
          failed={finalizeFailed}
          onFinalize={() => void finalize()}
          description={t('draft.epicDescription')}
        />
      )}
      <div className="detail__viewport" ref={setScroller}>
        <DetailSectionView snapshot={detail.document} onRetry={() => void detail.refresh()}>
          {(data, arriving) => (
            <>
              {data.blocks.every((block) => block.text.trim() === '') ? (
                // Empty epic details have one placeholder; the images follow it.
                arriving ? null : (
                  <p className="detail__empty">{t('epics.noDocument')}</p>
                )
              ) : (
                <DocumentBlocks
                  document={data}
                  arriving={arriving}
                  attachmentUrl={attachmentUrl}
                  scrollParent={scroller}
                />
              )}
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
      </div>
    </aside>
  );
}
