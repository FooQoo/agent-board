import { PencilIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Epic, ProjectId } from '../../types';
import { EpicBadge } from '../EpicBadge';
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

/** The read-only details of the selected epic: its label, name, plan, and images, with edit and close. */
export function EpicDetailPanel({ projectId, epic, onEdit, onClose }: EpicDetailPanelProps) {
  const { t } = useTranslation();
  return (
    <aside className="detail detail-view epic-detail" aria-label={t('epics.detailTitle')}>
      <div className="detail__top">
        <span className="detail__id">
          <EpicBadge epic={epic} className="epic-detail__badge" icon={false} />
        </span>
        <div className="detail__toolbar" role="toolbar" aria-label={t('detail.toolbar')}>
          <button
            type="button"
            className="detail__tool epic-detail__tool"
            aria-label={t('epics.edit')}
            title={t('epics.edit')}
            onClick={onEdit}
          >
            <PencilIcon aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="detail__close epic-detail__tool"
          aria-label={t('detail.close')}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </button>
      </div>
      <h2 className="detail__title" id="epic-detail-title">
        {epic.name}
      </h2>
      {epic.body.trim() === '' && <p className="detail__empty">{t('epics.noPlan')}</p>}
      <EpicTabView projectId={projectId} epic={epic} status="ready" />
    </aside>
  );
}
