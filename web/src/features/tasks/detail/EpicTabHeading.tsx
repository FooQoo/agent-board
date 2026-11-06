import { Maximize2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EpicRef } from '../../../shared/api/contracts';
import './detail.css';
import './epic-heading.css';

export interface EpicTabHeadingProps {
  epic: EpicRef;
  /** Draws the epic label. The caller supplies it, as the editor dialogs do. */
  renderLabel: (epic: EpicRef) => ReactNode;
  onOpen: () => void;
}

/** The top of the epic tab: the epic label with the full-screen button at its right, then the name. */
export function EpicTabHeading({ epic, renderLabel, onOpen }: EpicTabHeadingProps) {
  const { t } = useTranslation();
  return (
    <div className="detail__epic-heading">
      {renderLabel(epic)}
      <button
        type="button"
        className="detail__tool detail__tool--text detail__epic-open"
        aria-label={t('detail.openEpicFullscreen')}
        title={t('detail.openEpicFullscreen')}
        onClick={onOpen}
      >
        <Maximize2Icon aria-hidden="true" />
        {t('detail.openFullscreen')}
      </button>
      <h3 className="detail__epic-name">{epic.name}</h3>
    </div>
  );
}
