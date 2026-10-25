import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon } from 'lucide-react';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';
import type { TaskSummary, ColumnName } from '../../../shared/api/contracts';
import { TaskStatusChangedError } from '../api/lifecycle';
import { TaskStatusBadge } from '../status/DialogBadges';
import { DialogFrame } from '../../../shared/ui/dialog-frame/DialogFrame';

export function MoveDialog({
  task,
  target,
  onClose,
  onSavingChange,
  onSubmit,
}: {
  task: TaskSummary;
  target: ColumnName;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: { reason: string; fromStatus: ColumnName }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  // The status the task was found in when a move was refused: the board holds its updates while
  // the dialog is open, so the dialog shows the status the server named instead.
  const [found, setFound] = useState<ColumnName | null>(null);
  const from = found ?? task.taskStatus;
  const reasonId = useId();

  return (
    <DialogFrame
      title={t('dialog.moveTitle')}
      submitLabel={t('dialog.submitMove')}
      taskId={task.id}
      onClose={onClose}
      onSavingChange={onSavingChange}
      validate={() => ([...reason].length > 2000 ? t('dialog.reasonRequired') : null)}
      save={async () => {
        try {
          await onSubmit({
            fromStatus: from,
            reason: reason.trim()
              ? reason
              : t('dialog.moveReasonDefault', {
                  who: t('assignee.human'),
                  from: t(`column.${from}`),
                  to: t(`column.${target}`),
                }),
          });
        } catch (cause) {
          if (!(cause instanceof TaskStatusChangedError)) throw cause;
          setFound(cause.current);
          throw new Error(t('dialog.moveStatusChanged', { status: t(`column.${cause.current}`) }));
        }
      }}
    >
      <p className="modal__card">
        #{task.id} {task.title}
      </p>
      <div className="modal__statuses" role="group" aria-label={t('dialog.statusChange')}>
        <TaskStatusBadge status={from} />
        <ArrowRightIcon className="modal__arrow" aria-hidden="true" />
        <TaskStatusBadge status={target} />
      </div>
      <div className="modal__field">
        <Label htmlFor={reasonId}>{t('dialog.reason')}</Label>
        <Textarea
          id={reasonId}
          className="modal__textarea modal__textarea--tall"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          maxLength={2000}
        />
      </div>
      <p className="modal__hint">{t('dialog.moveHint')}</p>
    </DialogFrame>
  );
}
