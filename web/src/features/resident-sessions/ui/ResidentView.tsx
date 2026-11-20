import { useTranslation } from 'react-i18next';
import { PreviewBadge } from '@/shared/ui/preview-feature/PreviewBadge';
import { Surface } from '@/shared/ui/surface/Surface';
import type { ResidentPanelProps } from '../types';
import type { LogState } from '../useSessionLog';
import { ResidentLogPane } from './ResidentLogPane';
import { ResidentPanel } from './ResidentPanel';
import './resident.css';

/**
 * The dialog the settings row and the footer open: a modal on the PC, a bottom sheet in a narrow
 * window. It has two panes like the connection dialog: the settings and state on the left, the
 * agent's log on the right (under the settings on a phone).
 */
export function ResidentView({
  kind,
  onClose,
  log,
  ...panel
}: ResidentPanelProps & { kind: 'dialog' | 'sheet'; onClose: () => void; log: LogState }) {
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
      <div className="resident-split">
        <div className="resident-split__main">
          <ResidentPanel {...panel} />
        </div>
        <ResidentLogPane tool={panel.snapshot.health.tool ?? panel.choice.tool} log={log} />
      </div>
    </Surface>
  );
}
