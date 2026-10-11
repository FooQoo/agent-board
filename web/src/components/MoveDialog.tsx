import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Card, ColumnName } from '../types';
import { CardStatusBadge } from './DialogBadges';
import { DialogFrame } from './DialogFrame';

export function MoveDialog({
  card,
  target,
  onClose,
  onSavingChange,
  onSubmit,
}: {
  card: Card;
  target: ColumnName;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: { reason: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  // A default for the field only: whatever is in it when the dialog is submitted is the reason.
  const [reason, setReason] = useState(() =>
    t('dialog.moveReasonDefault', {
      who: t('assignee.human'),
      from: t(`column.${card.cardStatus}`),
      to: t(`column.${target}`),
    }),
  );
  const reasonId = useId();

  return (
    <DialogFrame
      title={t('dialog.moveTitle')}
      submitLabel={t('dialog.submitMove')}
      cardId={card.id}
      onClose={onClose}
      onSavingChange={onSavingChange}
      validate={() =>
        [...reason.trim()].length === 0 || [...reason].length > 2000
          ? t('dialog.reasonRequired')
          : null
      }
      save={() => onSubmit({ reason })}
    >
      <p className="modal__card">
        #{card.id} {card.title}
      </p>
      <div className="modal__statuses" role="group" aria-label={t('dialog.statusChange')}>
        <CardStatusBadge status={card.cardStatus} />
        <ArrowRightIcon className="modal__arrow" aria-hidden="true" />
        <CardStatusBadge status={target} />
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
