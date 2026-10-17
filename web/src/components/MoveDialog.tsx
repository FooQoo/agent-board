import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Task, ColumnName } from '../types';
import { TaskStatusBadge } from './DialogBadges';
import { DialogFrame } from './DialogFrame';

export function MoveDialog({
  task,
  target,
  onClose,
  onSavingChange,
  onSubmit,
}: {
  task: Task;
  target: ColumnName;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: { reason: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const reasonId = useId();

  return (
    <DialogFrame
      title={t('dialog.moveTitle')}
      submitLabel={t('dialog.submitMove')}
      taskId={task.id}
      onClose={onClose}
      onSavingChange={onSavingChange}
      validate={() => ([...reason].length > 2000 ? t('dialog.reasonRequired') : null)}
      save={() =>
        onSubmit({
          reason: reason.trim()
            ? reason
            : t('dialog.moveReasonDefault', {
                who: t('assignee.human'),
                from: t(`column.${task.taskStatus}`),
                to: t(`column.${target}`),
              }),
        })
      }
    >
      <p className="modal__card">
        #{task.id} {task.title}
      </p>
      <div className="modal__statuses" role="group" aria-label={t('dialog.statusChange')}>
        <TaskStatusBadge status={task.taskStatus} />
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
