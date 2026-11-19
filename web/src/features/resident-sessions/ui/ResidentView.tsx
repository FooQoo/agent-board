import { useTranslation } from 'react-i18next';
import { PreviewBadge } from '@/shared/ui/preview-feature/PreviewBadge';
import { Surface } from '@/shared/ui/surface/Surface';
import type { ResidentPanelProps } from '../types';
import { ResidentPanel } from './ResidentPanel';
import './resident.css';

/** The dialog the settings row and the footer open: a modal on the PC, a bottom sheet in a narrow window. */
export function ResidentView({
  kind,
  onClose,
  ...panel
}: ResidentPanelProps & { kind: 'dialog' | 'sheet'; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Surface
      kind={kind}
      title={t('resident.title')}
      badge={<PreviewBadge feature="resident" decorative />}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      className="resident-surface"
    >
      <ResidentPanel {...panel} />
    </Surface>
  );
}
