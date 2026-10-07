import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Card } from '../types';
import { RunStatusBadge } from './DialogBadges';
import { DialogFrame } from './DialogFrame';

export function AnswerDialog({
  card,
  onClose,
  onSavingChange,
  onSubmit,
}: {
  card: Card;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: { reason: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const reasonId = useId();

  return (
    <DialogFrame
      title={t('dialog.answerTitle')}
      submitLabel={t('dialog.submitAnswer')}
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
        <RunStatusBadge status={card.agentStatus} />
        <ArrowRightIcon className="modal__arrow" aria-hidden="true" />
        <RunStatusBadge status="idle" />
      </div>
      {card.pendingReason && (
        <div className="modal__request">
          <span className="modal__request-label">{t('dialog.agentRequest')}</span>
          <p className="modal__request-text">{card.pendingReason}</p>
        </div>
      )}
      <div className="modal__field">
        <Label htmlFor={reasonId}>{t('dialog.answer')}</Label>
        <Textarea
          id={reasonId}
          className="modal__textarea modal__textarea--medium"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={2000}
        />
      </div>
      <p className="modal__hint">{t('dialog.answerHint')}</p>
    </DialogFrame>
  );
}
