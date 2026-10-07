import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { stateLabel } from '../lib/format';
import { noOperations, type OperationControls } from '../lib/projectSession';
import type { Card, ProjectId } from '../types';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeleteButton } from './DeleteButton';
import { DeleteConfirm } from './DeleteConfirm';
import { HistoryTimeline } from './HistoryTimeline';
import { StatusLabel } from './StatusLabel';
import { AssigneeLabel } from './AssigneeLabel';

export interface DetailPanelProps {
  /** The project the card belongs to. Part keys and delete requests use it. */
  projectId: ProjectId | null;
  card: Card | null;
  /** Used where the panel only holds a project state (switching, failure, none): the hint sits at the top. */
  variant?: 'card' | 'state';
  /** Tells the app about the delete confirmation, so the project cannot change under it. */
  operations?: OperationControls;
  onClose: () => void;
  onAnswer?: () => void;
  /** The edit icon was pressed. The toolbar that calls this is added with the description tabs. */
  onEdit?: () => void;
  /** The draft toggle (Make draft / Finalize) was pressed. */
  onToggleDraft?: () => void;
  /** The card is gone (deleted here or already missing); the parent clears the selection and reloads. */
  onDeleted: () => void;
  /** Mock mode only: open the delete confirmation immediately. */
  initialConfirm?: boolean;
  /** Mock mode only: show the delete failure message immediately. */
  initialDeleteFailed?: boolean;
}

export function DetailPanel({
  projectId,
  card,
  variant = 'card',
  operations = noOperations,
  onClose,
  onAnswer,
  onEdit,
  onToggleDraft,
  onDeleted,
  initialConfirm,
  initialDeleteFailed,
}: DetailPanelProps) {
  const { t } = useTranslation();
  if (card === null || projectId === null) {
    return (
      <aside
        className={`detail detail--empty${variant === 'state' ? ' detail--state' : ''}`}
        aria-label={t('detail.title')}
      >
        <p className="detail__empty-message">
          {t(variant === 'state' ? 'detail.selectPromptState' : 'detail.selectPrompt')}
        </p>
      </aside>
    );
  }
  return (
    <DetailBody
      key={`${projectId}:${card.id}`}
      projectId={projectId}
      operations={operations}
      card={card}
      onClose={onClose}
      onAnswer={onAnswer}
      onEdit={onEdit}
      onToggleDraft={onToggleDraft}
      onDeleted={onDeleted}
      initialConfirm={initialConfirm}
      initialDeleteFailed={initialDeleteFailed}
    />
  );
}

interface DetailBodyProps
  extends Omit<DetailPanelProps, 'card' | 'variant' | 'operations' | 'projectId'> {
  projectId: ProjectId;
  card: Card;
  operations: OperationControls;
}

type ConfirmState = 'closed' | 'initial' | 'user';

function DetailBody({
  projectId,
  card,
  operations,
  onClose,
  onAnswer,
  onEdit: _onEdit,
  onToggleDraft: _onToggleDraft,
  onDeleted,
  initialConfirm,
  initialDeleteFailed,
}: DetailBodyProps) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<ConfirmState>(initialConfirm ? 'initial' : 'closed');
  const deleteButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const state = stateLabel(card);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const operationId = useRef<number | null>(null);
  const confirming = confirm !== 'closed';

  // The open confirmation is an operation: the project cannot change until it is done or cancelled.
  useEffect(() => {
    if (!confirming) return;
    const id = operationsRef.current.begin('delete', projectId);
    operationId.current = id;
    return () => {
      operationsRef.current.end(id);
      operationId.current = null;
    };
  }, [confirming, projectId]);

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
              <>
                <Button type="button" onClick={onAnswer}>
                  {t('dialog.answerAction')}
                </Button>
              </>
            )}
            <DeleteButton ref={deleteButton} onClick={() => setConfirm('user')} />
            <span className="detail__spacer" aria-hidden="true" />
          </>
        ) : (
          <DeleteConfirm
            projectId={projectId}
            card={card}
            focusOnMount={confirm === 'user'}
            initialFailed={initialDeleteFailed}
            onCancel={() => {
              restoreFocus.current = true;
              setConfirm('closed');
            }}
            onSavingChange={(saving) => {
              const id = operationId.current;
              if (id === null) return;
              if (saving) operations.saveStarted(id);
              else operations.saveFailed(id);
            }}
            onDeleted={() => {
              const id = operationId.current;
              if (id !== null) operations.cardDeleted(id, projectId, card.id);
              onDeleted();
            }}
          />
        )}
      </div>
    </aside>
  );
}
