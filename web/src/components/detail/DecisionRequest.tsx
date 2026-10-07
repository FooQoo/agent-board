import { ChevronDownIcon, CircleAlertIcon, InfoIcon, LoaderIcon, PauseIcon } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { WriteError, answerRequest } from '../../api';
import type { OperationControls } from '../../lib/projectSession';
import type { Card, ProjectId } from '../../types';

const MAX_ANSWER = 2000;

/** True while the reason is cut by its line limit (measured, so it follows the column width). */
function useCut(ref: React.RefObject<HTMLElement | null>, text: string | null, active: boolean) {
  const [cut, setCut] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` changes what is measured.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || element === null) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, text, active]);
  return cut;
}

/**
 * The decision request of a pending card: the reason, and an answer form that opens in place.
 * The open form is an operation, so the project cannot change under it.
 */
export function DecisionRequest({
  projectId,
  card,
  operations,
  onChanged,
}: {
  projectId: ProjectId;
  card: Card;
  operations: OperationControls;
  /** An answer was saved (or found stale): the board should be fetched again. */
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('');
  const [phase, setPhase] = useState<'editing' | 'sending' | 'failed'>('editing');
  const [staleFlag, setStaleFlag] = useState(false);
  // The request the answer is written for; it follows the card once the person edits again.
  const [baseId, setBaseId] = useState<string | null>(card.pendingRequestId);
  const reasonRef = useRef<HTMLParagraphElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const answerButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const operationId = useRef<number | null>(null);
  const textareaId = useId();
  const messageId = useId();

  const cut = useCut(reasonRef, card.pendingReason, !expanded);
  const stale = staleFlag || card.pendingRequestId !== baseId;
  const filled = [...reason.trim()].length > 0;
  const sendable = filled && !stale && phase !== 'sending';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The open form holds the project in place until it is sent or cancelled.
  useEffect(() => {
    if (!open) return;
    const id = operationsRef.current.begin('answer', projectId);
    operationId.current = id;
    return () => {
      operationsRef.current.end(id);
      operationId.current = null;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      answerButton.current?.focus();
    }
  }, [open]);

  const openForm = () => {
    setReason('');
    setPhase('editing');
    setStaleFlag(false);
    setBaseId(card.pendingRequestId);
    setOpen(true);
  };

  const cancel = () => {
    if (sending.current) return;
    restoreFocus.current = true;
    setOpen(false);
  };

  const edit = (value: string) => {
    setReason(value);
    if (stale) {
      setStaleFlag(false);
      setBaseId(card.pendingRequestId);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sendable || sending.current) return;
    sending.current = true;
    setPhase('sending');
    const id = operationId.current;
    if (id !== null) operations.saveStarted(id);
    try {
      await answerRequest(projectId, card.id, baseId ?? '', reason);
      sending.current = false;
      if (mounted.current) setOpen(false);
      onChanged?.();
    } catch (error) {
      sending.current = false;
      if (id !== null) operations.saveFailed(id);
      if (!mounted.current) return;
      if (
        error instanceof WriteError &&
        (error.code === 'request_changed' || error.status === 404)
      ) {
        setStaleFlag(true);
        setPhase('editing');
        onChanged?.();
      } else {
        setPhase('failed');
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel();
    }
  };

  const failedText = stale
    ? t('request.changed')
    : phase === 'failed'
      ? t('detail.saveError')
      : null;

  return (
    <section className="detail__request" aria-label={t('request.title')}>
      <p className="detail__banner-head">
        <PauseIcon aria-hidden="true" />
        <span>{t('request.title')}</span>
      </p>
      {card.pendingReason && (
        <>
          <p
            ref={reasonRef}
            className={`detail__reason${expanded ? '' : ' detail__reason--clamped'}`}
          >
            {card.pendingReason}
          </p>
          {!expanded && cut && (
            <button type="button" className="detail__more" onClick={() => setExpanded(true)}>
              {t('request.showMore')}
              <ChevronDownIcon aria-hidden="true" />
            </button>
          )}
        </>
      )}
      {open ? (
        <form className="detail__answer" onSubmit={submit} onKeyDown={onKeyDown}>
          <label className="visually-hidden" htmlFor={textareaId}>
            {t('request.label')}
          </label>
          <Textarea
            ref={textareaRef}
            id={textareaId}
            className="detail__answer-input"
            value={reason}
            placeholder={t('request.placeholder')}
            maxLength={MAX_ANSWER}
            disabled={phase === 'sending'}
            aria-invalid={failedText !== null}
            aria-describedby={messageId}
            onChange={(event) => edit(event.target.value)}
          />
          <div id={messageId}>
            {failedText !== null ? (
              <p className="detail__error detail__error--icon" role="alert">
                <CircleAlertIcon aria-hidden="true" />
                {failedText}
              </p>
            ) : phase === 'sending' ? null : (
              <p className="detail__hint">
                {filled ? null : <InfoIcon aria-hidden="true" />}
                {filled ? t('request.hint') : t('request.hintEmpty')}
              </p>
            )}
          </div>
          <div className="detail__answer-actions">
            <Button
              type="button"
              variant="ghost"
              className="detail-btn detail-btn--sm detail-btn--quiet"
              disabled={phase === 'sending'}
              onClick={cancel}
            >
              {t('request.cancel')}
            </Button>
            <Button type="submit" className="detail-btn detail-btn--sm" disabled={!sendable}>
              {phase === 'sending' ? (
                <>
                  <LoaderIcon aria-hidden="true" />
                  {t('request.sending')}
                </>
              ) : phase === 'failed' && !stale ? (
                t('request.retry')
              ) : (
                t('request.send')
              )}
            </Button>
          </div>
        </form>
      ) : (
        <Button ref={answerButton} type="button" className="detail-btn" onClick={openForm}>
          {t('request.answer')}
        </Button>
      )}
    </section>
  );
}
