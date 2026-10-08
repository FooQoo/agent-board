import { FilePenIcon, PencilIcon as EditIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setDraft } from '../api';
import { stateLabel } from '../lib/format';
import { historyItems } from '../lib/history';
import { noOperations, type OperationControls } from '../lib/projectSession';
import type { Card, ProjectId } from '../types';
import { AssigneeLabel } from './AssigneeLabel';
import { DeleteButton } from './DeleteButton';
import { DeleteConfirm } from './DeleteConfirm';
import { DecisionRequest } from './detail/DecisionRequest';
import { DetailAttachments } from './detail/DetailAttachments';
import { DetailTabs, type DetailTab, panelId, tabId } from './detail/DetailTabs';
import { DraftBanner } from './detail/DraftBanner';
import { HistoryTimeline } from './HistoryTimeline';
import { MarkdownSections } from './markdown/MarkdownSections';
import { StatusLabel } from './StatusLabel';
import '../styles/detail.css';

export interface DetailPanelProps {
  /** The project the card belongs to. Part keys and delete requests use it. */
  projectId: ProjectId | null;
  card: Card | null;
  /** Used where the panel only holds a project state (switching, failure, none): the hint sits at the top. */
  variant?: 'card' | 'state';
  /** Tells the app about the delete confirmation, so the project cannot change under it. */
  operations?: OperationControls;
  onClose: () => void;
  /** The edit icon (shown for a draft) was pressed. */
  onEdit?: (card: Card) => void;
  /** A draft toggle or an answer was saved: the board should be fetched again. */
  onChanged?: () => void;
  /** The card is gone (deleted here or already missing); the parent clears the selection and reloads. */
  onDeleted: () => void;
  /** Mock mode only: open the delete confirmation immediately. */
  initialConfirm?: boolean;
  /** Mock mode only: show the delete failure message immediately. */
  initialDeleteFailed?: boolean;
  /** Archive view changes the destructive action to permanent deletion. */
  archived?: boolean;
  onRestore?: () => void;
}

export function DetailPanel({
  projectId,
  card,
  variant = 'card',
  operations = noOperations,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
  initialConfirm,
  initialDeleteFailed,
  archived = false,
  onRestore,
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
      onEdit={onEdit}
      onChanged={onChanged}
      onDeleted={onDeleted}
      initialConfirm={initialConfirm}
      initialDeleteFailed={initialDeleteFailed}
      archived={archived}
      onRestore={onRestore}
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
  onEdit,
  onChanged,
  onDeleted,
  initialConfirm,
  initialDeleteFailed,
  archived,
  onRestore,
}: DetailBodyProps) {
  const { t } = useTranslation();
  const idBase = useId();
  const [tab, setTab] = useState<DetailTab>('description');
  const [confirm, setConfirm] = useState<ConfirmState>(initialConfirm ? 'initial' : 'closed');
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  const draftBusy = useRef(false);
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

  const toggleDraft = async (isDraft: boolean) => {
    if (draftBusy.current) return;
    draftBusy.current = true;
    setDraftSaving(true);
    setDraftFailed(false);
    try {
      await setDraft(projectId, card.id, isDraft);
      onChanged?.();
    } catch {
      setDraftFailed(true);
    } finally {
      draftBusy.current = false;
      setDraftSaving(false);
    }
  };

  const canMakeDraft = !card.isDraft && card.agentStatus !== 'running';

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
      {card.isDraft && !archived && (
        <DraftBanner
          busy={draftSaving}
          failed={draftFailed}
          onFinalize={() => void toggleDraft(false)}
        />
      )}
      {!archived && card.agentStatus === 'pending' && (
        <DecisionRequest
          projectId={projectId}
          card={card}
          operations={operations}
          onChanged={onChanged}
        />
      )}
      {confirming && (
        <DeleteConfirm
          projectId={projectId}
          card={card}
          action={archived ? 'delete' : 'archive'}
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
      <DetailTabs
        idBase={idBase}
        tab={tab}
        historyCount={historyItems(card.history).length}
        onChange={setTab}
      >
        <div className="detail__toolbar" role="toolbar" aria-label={t('detail.toolbar')}>
          {tab === 'description' && !archived && card.isDraft && (
            <button
              type="button"
              className="detail__tool"
              aria-label={t('detail.edit')}
              title={t('detail.edit')}
              onClick={() => onEdit?.(card)}
            >
              <EditIcon aria-hidden="true" />
            </button>
          )}
          {tab === 'description' && !archived && canMakeDraft && (
            <button
              type="button"
              className="detail__tool detail__tool--text"
              aria-label={t('detail.makeDraft')}
              title={t('detail.makeDraft')}
              disabled={draftSaving}
              onClick={() => void toggleDraft(true)}
            >
              <FilePenIcon aria-hidden="true" />
              {t('detail.makeDraft')}
            </button>
          )}
          <DeleteButton
            ref={deleteButton}
            action={archived ? 'delete' : 'archive'}
            onClick={() => setConfirm('user')}
          />
        </div>
      </DetailTabs>
      {archived && onRestore && (
        <button type="button" className="detail__restore" onClick={onRestore}>
          {t('archive.restore')}
        </button>
      )}
      {draftFailed && !card.isDraft && (
        <p className="detail__error" role="alert">
          {t('detail.saveError')}
        </p>
      )}
      {/* Both panels stay mounted, so the folds of the description survive a look at the history. */}
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'description')}
        aria-labelledby={tabId(idBase, 'description')}
        hidden={tab !== 'description'}
      >
        <MarkdownSections
          source={card.description}
          resolveAttachment={(id) =>
            card.attachments?.some((a) => a.id === id)
              ? `/api/projects/${projectId}/cards/${card.id}/attachments/${id}`
              : null
          }
        />
        <DetailAttachments
          projectId={projectId}
          cardId={card.id}
          attachments={card.attachments ?? []}
        />
      </div>
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'history')}
        aria-labelledby={tabId(idBase, 'history')}
        hidden={tab !== 'history'}
      >
        <HistoryTimeline events={card.history} />
      </div>
    </aside>
  );
}
