import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId } from '@/shared/api/contracts';
import { resolveMessageImage } from '@/shared/api/messageAttachment';
import type { Message } from '@/shared/data/api/contracts';
import { Button } from '@/shared/ui/button';
import { keepFocusOnPress } from '@/shared/ui/keepFocus';
import { attachmentNoticeText } from '@/shared/ui/editor/AttachmentPanel';
import { useAttachmentState } from '@/shared/ui/editor/useAttachmentState';
import { Surface } from '@/shared/ui/surface/Surface';
import { DecisionAnswerFields } from '../answer/DecisionAnswerFields';
import { DecisionQuestion } from '../answer/DecisionQuestion';
import type { DecisionAnswerView } from '../answer/decisionAnswerView';
import { BackButton, DetailState, failureKey } from './MessageDetailParts';
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
import { useSummaries } from './useSummaries';
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
  const images = useAttachmentState({ resolveStoredUrl: () => '' });
  const [failure, setFailure] = useState<'conflict' | 'gone' | 'failed' | 'withdraw' | null>(null);

  const listed = useMemo(
    () => messages.find((message) => message.id === openId) ?? null,
    [messages, openId],
  );
  // A message that leaves the list (answered, picked up, withdrawn) takes the person back to it.
  useEffect(() => {
    if (openId !== null && listed === null && !busy) setOpenId(null);
  }, [openId, listed, busy]);

  // The body is one scroller shared by the list and every opened message, so it keeps the scroll
  // position of whichever was shown before. Each switch starts at the top.
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.dataset.opened = openId ?? '';
      bodyRef.current.scrollTop = 0;
    }
  }, [openId]);

  const summaries = useSummaries(api.summaries, projectId);

  const { detail, state, reload } = useMessageDetail(
    api.read,
    projectId,
    listed ? listed.id : null,
  );

  const show = (id: string | null) => {
    setOpenId(id);
    setChoiceId(null);
    setText('');
    images.clear();
    setFailure(null);
  };

  const opened = listed?.type === 'question' || listed?.type === 'request' ? listed : null;
  const choices = detail?.choices ?? [];
  const answering = opened?.type === 'question' && opened.turn === 'human';
  const sendable = answering && detail !== null && !busy && canSendAnswer(choices, choiceId, text);
  // The demo build keeps nothing it could save pictures to.
  const picturesAllowed = import.meta.env.MODE !== 'demo';
  const addImages = (files: File[]) => {
    const pictures = files.filter((file) => file.type.startsWith('image/'));
    if (pictures.length > 0) images.addFiles(pictures);
  };

  const send = async () => {
    if (!opened || !sendable) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.answer(
        projectId,
        [
          {
            questionId: opened.id,
            ...(choiceId !== null ? { choiceId } : {}),
            ...(text.trim() !== '' ? { text } : {}),
          },
        ],
        images.attachments,
      );
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
    hasInput: choiceId !== null || text.trim() !== '' || images.attachments.length > 0,
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

  // On the PC a message opened from the list offers the way back at the top of its body; a phone
  // sheet puts it in the footer instead (below), so the body starts with the message itself.
  const goBack = () => show(null);
  const phoneBack = kind === 'sheet' && fromList && opened !== null;
  const back = fromList && kind === 'dialog' ? <BackButton onBack={goBack} /> : null;
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
        swipe
        kind={kind}
        summaries={api.summaries ? summaries : undefined}
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
    // The answer's images are stored with the question, so they are drawn like the images of its body.
    const answerImages = (reply?.images ?? [])
      .map((name) => `![${name}](attachments/${name})`)
      .join('\n\n');
    body = (
      <div className="message-detail">
        {back}
        <p className="message-detail__blocks">{t('messages.detail.answerNote')}</p>
        <DecisionQuestion
          question={detail.body}
          resolveAttachment={resolveAttachment}
          resolveImage={resolveImage}
        />
        {(answer !== '' || answerImages !== '') && (
          <section className="message-detail__answer" aria-label={t('messages.detail.yourAnswer')}>
            <h3>{t('messages.detail.yourAnswer')}</h3>
            {answer !== '' && <p>{answer}</p>}
            {answerImages !== '' && (
              <DecisionQuestion question={answerImages} resolveImage={resolveImage} />
            )}
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
              images.clear();
            }}
            images={
              picturesAllowed
                ? {
                    attachments: images.attachments,
                    notice: images.error ? attachmentNoticeText(images.error, t) : '',
                    onFiles: addImages,
                    onRemove: images.remove,
                  }
                : undefined
            }
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
      bodyRef={bodyRef}
      className={
        answering ? 'message-surface message-surface--answering decision-dialog' : 'message-surface'
      }
      footer={
        (answering || phoneBack) && (
          <div className="message-bar">
            {phoneBack ? (
              <Button type="button" variant="outline" disabled={busy} onClick={goBack}>
                {t('messages.detail.back')}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onClose}>
                {t('messages.detail.later')}
              </Button>
            )}
            {answering && (
              <Button
                type="button"
                disabled={!sendable}
                onClick={() => void send()}
                {...keepFocusOnPress}
              >
                {busy ? t('messages.detail.sending') : t('messages.detail.send')}
              </Button>
            )}
          </div>
        )
      }
    >
      {body}
    </Surface>
  );
}

export type { MessageDetail };
