import { CircleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Drawer } from '@/shared/ui/drawer';
import { DecisionAnswerPanel, type DecisionAnswerPanelProps } from './DecisionAnswerPanel';
import './decision-answer.css';

export interface DecisionAnswerSheetProps extends DecisionAnswerPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The line above the title: `#14`. */
  identity: string;
  /** The card's title. */
  title: string;
  onSubmit: () => void;
  onRetry: () => void;
}

/** The monitor's answer sheet: the same question and answer, from the bottom, with the send pinned. */
export function DecisionAnswerSheet({
  open,
  onOpenChange,
  identity,
  title,
  onSubmit,
  onRetry,
  ...panel
}: DecisionAnswerSheetProps) {
  const { t } = useTranslation();
  const { view } = panel;
  const sending = view.phase === 'sending';
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!sending) onOpenChange(next);
      }}
      identity={identity}
      title={title}
      className="decision-sheet-popup"
      initialFocusSelector='[role="radio"], textarea'
    >
      <div className="decision-sheet">
        <DecisionAnswerPanel {...panel} />
        {view.phase === 'failed' && view.failure !== null && (
          <div className="decision-sheet__failure" role="alert">
            <CircleAlertIcon aria-hidden="true" />
            <span>{view.failure}</span>
            <Button type="button" variant="outline" size="s" onClick={onRetry}>
              {t('editor.retry')}
            </Button>
          </div>
        )}
        {view.notice !== 'withdrawn' && (
          <div className="decision-sheet__bar">
            <Button type="button" size="l" disabled={!view.sendable} onClick={onSubmit}>
              {sending ? t('request.sending') : t('request.send')}
            </Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}
