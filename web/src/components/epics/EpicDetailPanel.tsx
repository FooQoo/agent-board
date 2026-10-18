import { PencilIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Epic, ProjectId } from '../../types';
import { EpicBadge } from '../EpicBadge';
import { DetailAttachments } from '../detail/DetailAttachments';
import { EpicTabView } from '../detail/EpicTabView';
import '../../styles/detail.css';
import '../../styles/epics.css';

export interface EpicDetailPanelProps {
  projectId: ProjectId;
  epic: Epic;
  /** Opens the existing epic editor. */
  onEdit: () => void;
  onClose: () => void;
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

/** The read-only details of the selected epic: its label, name, plan, and images, with edit and close. */
export function EpicDetailPanel({ projectId, epic, onEdit, onClose }: EpicDetailPanelProps) {
  const { t } = useTranslation();
  return (
    <aside className="detail detail-view epic-detail" aria-label={t('epics.detailTitle')}>
      <div className="detail__top">
        <span className="detail__id epic-detail__tags">
          <EpicBadge epic={epic} className="epic-detail__badge" icon={false} />
          {epic.isDraft && <span className="card__draft">{t('draft.label')}</span>}
        </span>
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
            className="detail__close"
            aria-label={t('detail.close')}
            title={t('detail.close')}
            onClick={onClose}
          >
            <XIcon aria-hidden="true" />
          </button>
        </div>
      </div>
      <h2 className="detail__title" id="epic-detail-title">
        {epic.name}
      </h2>
      {epic.body.trim() === '' ? (
        // An empty plan has one placeholder; the Markdown view would add its own, so only the images follow it.
        <>
          <p className="detail__empty">{t('epics.noPlan')}</p>
          <DetailAttachments
            projectId={projectId}
            taskId={0}
            attachments={epic.attachments}
            attachmentUrl={(id) =>
              `/api/projects/${projectId}/epics/${encodeURIComponent(epic.id)}/attachments/${encodeURIComponent(id)}`
            }
          />
        </>
      ) : (
        <EpicTabView projectId={projectId} epic={epic} status="ready" />
      )}
    </aside>
  );
}
