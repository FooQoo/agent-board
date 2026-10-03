import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { stateLabel } from '../lib/format';
import type { Card } from '../types';
import { ColumnChip } from './ColumnChip';
import { DeleteButton } from './DeleteButton';
import { DeleteConfirm } from './DeleteConfirm';
import { HistoryTimeline } from './HistoryTimeline';
import { Close } from './icons';
import { RunStateBadge } from './RunStateBadge';
import { SectionHeading } from './SectionHeading';

export interface DetailPanelProps {
  card: Card | null;
  onClose: () => void;
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
          className="icon-button"
          aria-label={t('detail.close')}
          onClick={onClose}
        >
          <Close />
        </button>
      </div>
      <h2 className="detail__title">{card.title}</h2>
      <div className="detail__meta">
        <ColumnChip column={card.column} />
        {state !== null && <RunStateBadge state={card.run_state} />}
      </div>
      {card.run_state === 'pending' && card.pending_reason && (
        <p className="detail__reason">{card.pending_reason}</p>
      )}
      <SectionHeading>{t('detail.description')}</SectionHeading>
      {card.description === '' ? (
        <p className="detail__description detail__description--empty">
          {t('detail.noDescription')}
        </p>
      ) : (
        <p className="detail__description">{card.description}</p>
      )}
      <SectionHeading>{t('history.title')}</SectionHeading>
      <HistoryTimeline transitions={card.transitions} />
      <div className="detail__spacer" />
      <div className="detail__actions">
        {confirm === 'closed' ? (
          <DeleteButton ref={deleteButton} onClick={() => setConfirm('user')} />
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
