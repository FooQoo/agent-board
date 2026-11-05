import { Maximize2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import type { EpicRef } from '../../../shared/api/contracts';
import './epic-heading.css';

export interface EpicTabHeadingProps {
  epic: EpicRef;
  /** Draws the epic label. The caller supplies it, as the editor dialogs do. */
  renderLabel: (epic: EpicRef) => ReactNode;
  onOpen: () => void;
}

/** The top of the epic tab: the epic label, its name, and the button that opens it full screen. */
export function EpicTabHeading({ epic, renderLabel, onOpen }: EpicTabHeadingProps) {
  const { t } = useTranslation();
  return (
    <div className="detail__epic-heading">
      {renderLabel(epic)}
      <h3 className="detail__epic-name">{epic.name}</h3>
      <Button type="button" variant="outline" size="s" onClick={onOpen}>
        <Maximize2Icon aria-hidden="true" />
        {t('detail.openFullscreen')}
      </Button>
    </div>
  );
}
