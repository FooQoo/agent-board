import { ArrowLeftIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId } from '@/shared/api/contracts';
import { resolveMessageImage } from '@/shared/api/messageAttachment';
import { WriteError } from '@/shared/api/writeErrors';
import type { Message } from '@/shared/data/api/contracts';
import { Button } from '@/shared/ui/button';
import { Surface } from '@/shared/ui/surface/Surface';
import { DecisionAnswerFields } from '../answer/DecisionAnswerFields';
import { DecisionQuestion } from '../answer/DecisionQuestion';
import type { DecisionAnswerView } from '../answer/decisionAnswerView';
import { MessageList } from './MessageRows';
import {
  canSendAnswer,
  type MessageDetail,
  type MessageTab,
  type MessagesApi,
  MAX_ANSWER_TEXT,
} from './model/messages';
import type { MessagesPanelTarget } from './useMessagesPanel';
import { useMessageDetail } from './useMessageDetail';
import './messages.css';

export interface MessagesSurfaceProps {
  projectId: ProjectId;
  /** The open messages of the project. */
  messages: readonly Message[];
  /** A modal on the PC board, a bottom sheet on a phone. */
  kind: 'dialog' | 'sheet';
  /** Where the list opens. */
  target: MessagesPanelTarget;
  api: MessagesApi;
  /** An answer or a withdrawal was saved; the screen reads the project again at once. */
  onChanged: () => void;
  onClose: () => void;
  /** Turns an `attachment:<id>` image of a message into its URL; null when there is no such file. */
  resolveAttachment?: (message: Message, attachmentId: string) => string | null;
}

/** How a failed write is told: a conflict (409) is the question changing under the person. */
function failureKey(error: unknown): 'conflict' | 'gone' | 'failed' {
  if (error instanceof WriteError && error.status === 409) return 'conflict';
  if (error instanceof WriteError && error.status === 404) return 'gone';
  return 'failed';
}

function DetailState({ state, onReload }: { state: 'loading' | 'failed'; onReload: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="message-detail__state" role={state === 'failed' ? 'alert' : 'status'}>
      <p>{state === 'failed' ? t('messages.detail.loadFailed') : t('messages.detail.loading')}</p>
      {state === 'failed' && (
        <Button type="button" variant="outline" size="s" onClick={onReload}>
          {t('messages.detail.reload')}
        </Button>
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      size="s"
      className="message-detail__back"
      onClick={onBack}
    >
      <ArrowLeftIcon aria-hidden="true" />
      {t('messages.detail.back')}
    </Button>
  );
}

/**
 * The list of open messages and the opened one, in a modal or a bottom sheet. An opened question
 * is the question on the left and the answer on the right (stacked on a phone), with "Later" and
 * "Send answer" pinned in the footer. An opened request shows its text and can be withdrawn while
 * no agent has picked it up. Closed messages are never listed.
 */
export function MessagesSurface({
  projectId,
  messages,
  kind,
  target,
  api,
  onChanged,
  onClose,
  resolveAttachment: resolveFor,
}: MessagesSurfaceProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MessageTab>(target.tab ?? 'fromAi');
  const [openId, setOpenId] = useState<string | null>(target.openId ?? null);
  // A message opened from a card or a review comes straight to its detail; only one opened from
  // the list offers the way back to it.
  const [fromList, setFromList] = useState(false);
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<'conflict' | 'gone' | 'failed' | 'withdraw' | null>(null);

  const listed = useMemo(
    () => messages.find((message) => message.id === openId) ?? null,
    [messages, openId],
  );
  // A message that leaves the list (answered, picked up, withdrawn) takes the person back to it.
  useEffect(() => {
    if (openId !== null && listed === null && !busy) setOpenId(null);
  }, [openId, listed, busy]);

  const { detail, state, reload } = useMessageDetail(
    api.read,
    projectId,
    listed ? listed.id : null,
  );

  const show = (id: string | null) => {
    setOpenId(id);
    setChoiceId(null);
    setText('');
    setFailure(null);
  };

  const opened = listed?.type === 'question' || listed?.type === 'request' ? listed : null;
  const choices = detail?.choices ?? [];
  const answering = opened?.type === 'question' && opened.turn === 'human';
  const sendable = answering && detail !== null && !busy && canSendAnswer(choices, choiceId, text);

  const send = async () => {
    if (!opened || !sendable) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.answer(projectId, [
        {
          questionId: opened.id,
          ...(choiceId !== null ? { choiceId } : {}),
          ...(text.trim() !== '' ? { text } : {}),
        },
      ]);
      onChanged();
      show(null);
    } catch (error) {
      setFailure(failureKey(error));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    if (!opened) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.withdraw(projectId, opened.id);
      onChanged();
      show(null);
    } catch {
      setFailure('withdraw');
    } finally {
      setBusy(false);
    }
  };

  const view: DecisionAnswerView = {
    choiceId,
    text,
    phase: busy ? 'sending' : 'editing',
    notice: null,
    failure: null,
    tooLong: [...text].length > MAX_ANSWER_TEXT,
    sendable: sendable === true,
    disabled: busy,
    hasInput: choiceId !== null || text.trim() !== '',
  };
  const resolveAttachment =
    resolveFor && opened ? (id: string) => resolveFor(opened, id) : undefined;
  // The images sent with the message are written `attachments/<name>` in its body.
  const resolveImage = opened
    ? (src: string) => resolveMessageImage(projectId, opened.id, src)
    : undefined;
  const failureText =
    failure === null
      ? null
      : failure === 'withdraw'
        ? t('messages.detail.withdrawFailed')
        : t(`messages.detail.${failure}`);

  const back = fromList ? <BackButton onBack={() => show(null)} /> : null;
  const blocks = opened && opened.tasks.length > 0 && (
    <p className="message-detail__blocks">
      {t('messages.detail.blocks', { tasks: opened.tasks.map((id) => `#${id}`).join(' ') })}
    </p>
  );

  let body: React.ReactNode;
  if (opened === null) {
    body = (
      <MessageList
        messages={messages}
        tab={tab}
        onTabChange={setTab}
        swipe={kind === 'sheet'}
        onOpen={(message) => {
          setFromList(true);
          show(message.id);
        }}
      />
    );
  } else if (detail === null) {
    body = (
      <div className="message-detail">
        {back}
        <DetailState state={state === 'failed' ? 'failed' : 'loading'} onReload={reload} />
      </div>
    );
  } else if (opened.type === 'question' && !answering) {
    // Answered: the question and the answer, read only, until an AI takes the answer in.
    const reply = detail.reply;
    const answer = [reply?.choiceLabel, reply?.text].filter(Boolean).join(' — ');
    body = (
      <div className="message-detail">
        {back}
        <p className="message-detail__blocks">{t('messages.detail.answerNote')}</p>
        <DecisionQuestion
          question={detail.body}
          resolveAttachment={resolveAttachment}
          resolveImage={resolveImage}
        />
        {answer !== '' && (
          <section className="message-detail__answer" aria-label={t('messages.detail.yourAnswer')}>
            <h3>{t('messages.detail.yourAnswer')}</h3>
            <p>{answer}</p>
          </section>
        )}
      </div>
    );
  } else if (opened.type === 'question') {
    body = (
      <div className="decision-panel message-detail message-detail--panel">
        <div className="decision-panel__question message-detail__question">
          {back}
          {blocks}
          <DecisionQuestion
            question={detail.body}
            resolveAttachment={resolveAttachment}
            resolveImage={resolveImage}
          />
        </div>
        <div className="decision-panel__answer">
          <DecisionAnswerFields
            choices={choices}
            view={view}
            onChoiceChange={setChoiceId}
            onTextChange={setText}
            onClear={() => {
              setChoiceId(null);
              setText('');
            }}
          />
          {failureText !== null && (
            <p className="message-detail__error" role="alert">
              {failureText}
            </p>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="message-detail">
        {back}
        <p className="message-detail__blocks">{t('messages.detail.requestNote')}</p>
        <DecisionQuestion
          question={detail.body}
          resolveAttachment={resolveAttachment}
          resolveImage={resolveImage}
        />
        {failureText !== null && (
          <p className="message-detail__error" role="alert">
            {failureText}
          </p>
        )}
        {opened.turn === 'ai' && (
          <div className="message-bar">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void withdraw()}>
              {busy ? t('messages.detail.withdrawing') : t('messages.detail.withdraw')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Surface
      kind={kind}
      title={t('messages.title')}
      closeLabel={t('messages.list.close')}
      onClose={onClose}
      className={
        answering ? 'message-surface message-surface--answering decision-dialog' : 'message-surface'
      }
      footer={
        answering && (
          <div className="message-bar">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('messages.detail.later')}
            </Button>
            <Button type="button" disabled={!sendable} onClick={() => void send()}>
              {busy ? t('messages.detail.sending') : t('messages.detail.send')}
            </Button>
          </div>
        )
      }
    >
      {body}
    </Surface>
  );
}

export type { MessageDetail };
