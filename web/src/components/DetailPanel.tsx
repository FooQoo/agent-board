import { useEffect, useRef, useState } from 'react';
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

export function DetailPanel({ card, onClose, onDeleted, initialConfirm, initialDeleteFailed }: DetailPanelProps) {
  if (card === null) {
    return (
      <aside className="detail detail--empty" aria-label="Card details">
        <p className="detail__empty-message">Select a card to see its details.</p>
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

function DetailBody({ card, onClose, onDeleted, initialConfirm, initialDeleteFailed }: DetailBodyProps) {
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
    <aside className="detail" aria-label="Card details">
      <div className="detail__top">
        <span className="detail__id">#{card.id}</span>
        <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}>
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
      <SectionHeading>Description</SectionHeading>
      {card.description === '' ? (
        <p className="detail__description detail__description--empty">No description.</p>
      ) : (
        <p className="detail__description">{card.description}</p>
      )}
      <SectionHeading>History</SectionHeading>
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
