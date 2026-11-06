import { InfoIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { EditorShell } from '@/shared/ui/editor/EditorShell';
import { StateChip } from '@/shared/ui/editor/StateChip';
import { decisionAnswerButtonSelector } from './DecisionAnswerButton';
import { DecisionAnswerPanel, type DecisionAnswerPanelProps } from './DecisionAnswerPanel';
import './decision-answer.css';

export interface DecisionAnswerDialogProps extends DecisionAnswerPanelProps {
  taskId: number;
  /** The card's title, shown in the header. */
  title: string;
  /** Where the focus goes on close; the card's answer button unless a screen says otherwise. */
  returnFocusSelector?: string;
  onClose: () => void;
  onSubmit: () => void;
  onRetry: () => void;
}

/** The PC answer dialog: the editor frame around the question and the answer. */
export function DecisionAnswerDialog({
  taskId,
  title,
  returnFocusSelector,
  onClose,
  onSubmit,
  onRetry,
  ...panel
}: DecisionAnswerDialogProps) {
  const { t } = useTranslation();
  const { view } = panel;
  const sending = view.phase === 'sending';
  const hint = (
    <span className="decision-dialog__hint">
      <InfoIcon aria-hidden="true" />
      {t('request.saveHint')}
    </span>
  );
  return (
    <EditorShell
      taskId={taskId}
      returnFocusSelector={returnFocusSelector ?? decisionAnswerButtonSelector(taskId)}
      title={title}
      badge={<StateChip kind="pending" />}
      variant="edit"
      dirty={false}
      saving={sending}
      error={view.phase === 'failed' ? view.failure : null}
      onRetry={onRetry}
      onClose={onClose}
      status={hint}
      savingStatus={hint}
      closeLabel={t('answer.close')}
      initialFocusSelector='[role="radio"], textarea'
      className="decision-dialog"
      actions={
        view.notice === 'withdrawn' ? null : (
          <Button type="button" disabled={!view.sendable} onClick={onSubmit}>
            {sending ? t('request.sending') : t('request.send')}
          </Button>
        )
      }
    >
      <DecisionAnswerPanel {...panel} />
    </EditorShell>
  );
}
