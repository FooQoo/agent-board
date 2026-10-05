import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { stateLabel } from '../lib/format';
import type { Card } from '../types';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeleteButton } from './DeleteButton';
import { DeleteConfirm } from './DeleteConfirm';
import { HistoryTimeline } from './HistoryTimeline';
import { StatusLabel } from './StatusLabel';
import { AssigneeLabel } from './AssigneeLabel';

export interface DetailPanelProps {
  card: Card | null;
  onClose: () => void;
  onAnswer?: () => void;
  /** The card is gone (deleted here or already missing); the parent clears the selection and reloads. */
  onDeleted: () => void;
  /** Mock mode only: open the delete confirmation immediately. */
  initialConfirm?: boolean;
  /** Mock mode only: show the delete failure message immediately. */
  initialDeleteFailed?: boolean;
}

export function DetailPanel({
  card,
  onClose,
  onAnswer,
  onDeleted,
  initialConfirm,
  initialDeleteFailed,
}: DetailPanelProps) {
  const { t } = useTranslation();
  if (card === null) {
    return (
      <aside className="detail detail--empty" aria-label={t('detail.title')}>
        <p className="detail__empty-message">{t('detail.selectPrompt')}</p>
      </aside>
    );
  }
  return (
    <DetailBody
      key={card.id}
      card={card}
      onClose={onClose}
      onAnswer={onAnswer}
      onDeleted={onDeleted}
      initialConfirm={initialConfirm}
      initialDeleteFailed={initialDeleteFailed}
    />
  );
}

interface DetailBodyProps extends Omit<DetailPanelProps, 'card'> {
  card: Card;
}

type ConfirmState = 'closed' | 'initial' | 'user';

function DetailBody({
  card,
  onClose,
  onAnswer,
  onDeleted,
  initialConfirm,
  initialDeleteFailed,
}: DetailBodyProps) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<ConfirmState>(initialConfirm ? 'initial' : 'closed');
  const deleteButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const state = stateLabel(card);

  useEffect(() => {
    if (confirm === 'closed' && restoreFocus.current) {
      restoreFocus.current = false;
      deleteButton.current?.focus();
    }
  }, [confirm]);

  return (
    <aside className="detail" aria-label={t('detail.title')}>
      <div className="detail__top">
        <span className="detail__id">#{card.id}</span>
        <button
          type="button"
          className="detail__close"
          aria-label={t('detail.close')}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </button>
      </div>
      <h2 className="detail__title">{card.title}</h2>
      <div className="detail__meta">
        <StatusLabel kind="card" status={card.cardStatus} />
        {state !== null && <StatusLabel kind="agent" status={card.agentStatus} />}
        <AssigneeLabel assignee={card.assignee} />
        <span className="detail__assignee" aria-hidden="true">
          {t(`assignee.${card.assignee}`)}
        </span>
      </div>
      {card.agentStatus === 'pending' && card.pendingReason && (
        <div className="detail__pending">
          <p className="detail__pending-label">{t('dialog.agentRequest')}</p>
          <p className="detail__reason">{card.pendingReason}</p>
        </div>
      )}
      <h3 className="detail__heading">{t('detail.description')}</h3>
      {card.description === '' ? (
        <p className="detail__description detail__description--empty">
          {t('detail.noDescription')}
        </p>
      ) : (
        <p className="detail__description">{card.description}</p>
      )}
      <h3 className="detail__heading">{t('history.title')}</h3>
      <HistoryTimeline events={card.history} />
      <div className="detail__actions">
        {confirm === 'closed' ? (
          <>
            {card.agentStatus === 'pending' && card.pendingReason && (
              <Button type="button" onClick={onAnswer}>
                {t('dialog.answerAction')}
              </Button>
            )}
            <span className="detail__spacer" aria-hidden="true" />
            <DeleteButton ref={deleteButton} onClick={() => setConfirm('user')} />
          </>
        ) : (
          <DeleteConfirm
            card={card}
            focusOnMount={confirm === 'user'}
            initialFailed={initialDeleteFailed}
            onCancel={() => {
              restoreFocus.current = true;
              setConfirm('closed');
            }}
            onDeleted={onDeleted}
          />
        )}
      </div>
    </aside>
  );
}
