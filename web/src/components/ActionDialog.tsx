import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Assignee, Card, ColumnName } from '../types';
import { AssigneeLabel } from './AssigneeLabel';
import { StatusLabel } from './StatusLabel';
import { Close } from './icons';

export type DialogAction =
  | { kind: 'create' }
  | { kind: 'move'; card: Card; target: ColumnName }
  | { kind: 'answer'; card: Card };

export function ActionDialog({
  action,
  onClose,
  onSubmit,
}: {
  action: DialogAction;
  onClose: () => void;
  onSubmit: (data: {
    title?: string;
    description?: string;
    assignee?: Assignee;
    reason?: string;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState<Assignee>('ai');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const titleText =
    action.kind === 'create'
      ? t('dialog.createTitle')
      : action.kind === 'move'
        ? t('dialog.moveTitle')
        : t('dialog.answerTitle');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (action.kind === 'create' && [...title.trim()].length === 0) {
      setError(t('dialog.titleRequired'));
      return;
    }
    if (action.kind === 'create' && [...title.trim()].length > 100) {
      setError(t('dialog.titleTooLong'));
      return;
    }
    if (
      action.kind !== 'create' &&
      ([...reason.trim()].length === 0 || [...reason].length > 2000)
    ) {
      setError(t('dialog.reasonRequired'));
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ title: title.trim(), description, assignee, reason });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('dialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="action-dialog__backdrop">
      <section
        className="action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
      >
        <header className="action-dialog__header">
          <h2 id="action-dialog-title">{titleText}</h2>
          <button
            className="icon-button"
            type="button"
            aria-label={t('detail.close')}
            onClick={onClose}
          >
            <Close />
          </button>
        </header>
        <form onSubmit={submit}>
          {action.kind === 'create' ? (
            <>
              <label className="action-dialog__field">
                {t('dialog.cardTitle')}
                <input
                  value={title}
                  maxLength={100}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="action-dialog__field">
                {t('detail.description')}
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                />
              </label>
              <fieldset className="action-dialog__assignee">
                <legend>{t('dialog.assignee')}</legend>
                {(['ai', 'human'] as const).map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="assignee"
                      value={value}
                      checked={assignee === value}
                      onChange={() => setAssignee(value)}
                    />
                    <span aria-hidden="true">
                      <AssigneeLabel assignee={value} />
                    </span>
                    <span>
                      {t(value === 'ai' ? 'dialog.assigneeAgent' : 'dialog.assigneeUser')}
                    </span>
                  </label>
                ))}
              </fieldset>
            </>
          ) : (
            <>
              <div className="action-dialog__context">
                <span>
                  #{action.card.id} {action.card.title}
                </span>
                <div className="action-dialog__statuses">
                  <StatusLabel kind="card" status={action.card.cardStatus} />
                  {action.kind === 'move' ? (
                    <>
                      <span aria-hidden="true">→</span>
                      <StatusLabel kind="card" status={action.target} />
                    </>
                  ) : (
                    <>
                      <AssigneeLabel assignee={action.card.assignee} />
                      <StatusLabel kind="agent" status={action.card.agentStatus} />
                    </>
                  )}
                </div>
                {action.kind === 'answer' && action.card.pendingReason && (
                  <p className="detail__reason">{action.card.pendingReason}</p>
                )}
              </div>
              <label className="action-dialog__field">
                {action.kind === 'answer' ? t('dialog.answer') : t('dialog.reason')}
                <textarea
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={6}
                  maxLength={2000}
                />
              </label>
            </>
          )}
          {error && (
            <p className="action-dialog__error" role="alert">
              {error}
            </p>
          )}
          <footer className="action-dialog__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={onClose}
              disabled={saving}
            >
              {t('dialog.cancel')}
            </button>
            <button className="button button--primary" type="submit" disabled={saving}>
              {saving ? t('dialog.saving') : t('dialog.submit')}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
