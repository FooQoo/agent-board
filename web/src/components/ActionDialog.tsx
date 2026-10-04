import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  LoaderIcon,
  PauseIcon,
  UserIcon,
  XIcon,
} from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import '../styles/modal.css';
import type { Assignee, Card, ColumnName, RunState } from '../types';

export type DialogAction =
  | { kind: 'create' }
  | { kind: 'move'; card: Card; target: ColumnName }
  | { kind: 'answer'; card: Card };

/** The button of a card on the board (the focus target after a drag-and-drop move). */
function findCardButton(id: number): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('button.card')) {
    if (element.querySelector('.card__id')?.textContent === `#${id}`) return element;
  }
  return null;
}

function CardStatusBadge({ status }: { status: ColumnName }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'doing' ? 'default' : status === 'done' ? 'secondary' : 'outline'}>
      {status === 'done' && <CheckIcon aria-hidden="true" className="text-[color:var(--r-done)]" />}
      {t(`column.${status}`)}
    </Badge>
  );
}

function RunStatusBadge({ status }: { status: RunState }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={status === 'pending' ? 'pending' : status === 'running' ? 'secondary' : 'muted'}
    >
      {status === 'running' && (
        <LoaderIcon aria-hidden="true" className="text-[color:var(--r-text2)]" />
      )}
      {status === 'pending' && <PauseIcon aria-hidden="true" />}
      {t(`runState.${status}`)}
    </Badge>
  );
}

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
  // Set synchronously so a second submit or close in the same tick is refused.
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Where the focus was when the dialog opened (the button that opened it).
  const [opener] = useState(() => document.activeElement);
  const titleId = useId();
  const descriptionId = useId();
  const assigneeId = useId();
  const reasonId = useId();

  const titleText =
    action.kind === 'create'
      ? t('dialog.createTitle')
      : action.kind === 'move'
        ? t('dialog.moveTitle')
        : t('dialog.answerTitle');

  const submitKey =
    action.kind === 'create'
      ? 'dialog.submitCreate'
      : action.kind === 'move'
        ? 'dialog.submitMove'
        : 'dialog.submitAnswer';

  const close = () => {
    if (!savingRef.current) onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
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
    savingRef.current = true;
    setSaving(true);
    try {
      await onSubmit({ title: title.trim(), description, assignee, reason });
      savingRef.current = false;
      onClose();
    } catch (cause) {
      savingRef.current = false;
      setError(cause instanceof Error ? cause.message : t('dialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="modal action-dialog"
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (savingRef.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          formRef.current?.querySelector<HTMLElement>('input, textarea')?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
            opener.focus();
          } else if (action.kind !== 'create') {
            findCardButton(action.card.id)?.focus();
          }
        }}
      >
        <div className="modal__header">
          <DialogTitle className="modal__title">{titleText}</DialogTitle>
          <button
            type="button"
            className="modal__close"
            aria-label={t('dialog.close')}
            disabled={saving}
            onClick={close}
          >
            <XIcon aria-hidden="true" />
          </button>
        </div>
        <form className="modal__form" ref={formRef} onSubmit={submit} noValidate>
          {action.kind === 'create' ? (
            <>
              <div className="modal__field">
                <Label htmlFor={titleId}>{t('dialog.cardTitle')}</Label>
                <Input
                  id={titleId}
                  value={title}
                  maxLength={100}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="modal__field">
                <Label htmlFor={descriptionId}>{t('detail.description')}</Label>
                <Textarea
                  id={descriptionId}
                  className="modal__textarea modal__textarea--short"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div className="modal__field">
                <Label id={assigneeId}>{t('dialog.assignee')}</Label>
                <RadioGroup
                  className="segmented"
                  aria-labelledby={assigneeId}
                  value={assignee}
                  onValueChange={(value) => setAssignee(value === 'human' ? 'human' : 'ai')}
                >
                  {(['ai', 'human'] as const).map((value) => (
                    <RadioGroupPrimitive.Item
                      key={value}
                      value={value}
                      className="segmented__option"
                    >
                      {value === 'ai' ? (
                        <BotIcon aria-hidden="true" />
                      ) : (
                        <UserIcon aria-hidden="true" />
                      )}
                      {t(value === 'ai' ? 'dialog.assigneeAgent' : 'dialog.assigneeUser')}
                    </RadioGroupPrimitive.Item>
                  ))}
                </RadioGroup>
                <p className="modal__hint">{t('dialog.assigneeHint')}</p>
              </div>
              <div className="modal__destination">
                <span className="modal__caption">{t('dialog.createdIn')}</span>
                <CardStatusBadge status="todo" />
              </div>
            </>
          ) : (
            <>
              <p className="modal__card">
                #{action.card.id} {action.card.title}
              </p>
              <div className="modal__statuses" role="group" aria-label={t('dialog.statusChange')}>
                {action.kind === 'move' ? (
                  <>
                    <CardStatusBadge status={action.card.cardStatus} />
                    <ArrowRightIcon className="modal__arrow" aria-hidden="true" />
                    <CardStatusBadge status={action.target} />
                  </>
                ) : (
                  <>
                    <RunStatusBadge status={action.card.agentStatus} />
                    <ArrowRightIcon className="modal__arrow" aria-hidden="true" />
                    <RunStatusBadge status="idle" />
                  </>
                )}
              </div>
              {action.kind === 'answer' && action.card.pendingReason && (
                <div className="modal__request">
                  <span className="modal__request-label">{t('dialog.agentRequest')}</span>
                  <p className="modal__request-text">{action.card.pendingReason}</p>
                </div>
              )}
              <div className="modal__field">
                <Label htmlFor={reasonId}>
                  {action.kind === 'answer' ? t('dialog.answer') : t('dialog.reason')}
                </Label>
                <Textarea
                  id={reasonId}
                  className={`modal__textarea ${
                    action.kind === 'answer' ? 'modal__textarea--medium' : 'modal__textarea--tall'
                  }`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={2000}
                />
              </div>
              <p className="modal__hint">
                {action.kind === 'answer' ? t('dialog.answerHint') : t('dialog.moveHint')}
              </p>
            </>
          )}
          {error && (
            <p className="modal__error" role="alert">
              {error}
            </p>
          )}
          <div className="modal__actions">
            <Button type="button" variant="outline" onClick={close} disabled={saving}>
              {t('dialog.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('dialog.saving') : t(submitKey)}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
