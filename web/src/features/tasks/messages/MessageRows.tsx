import { CircleHelpIcon, SendIcon } from 'lucide-react';
import { type RefObject, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '@/shared/data/api/contracts';
import { useSwipePages } from '@/shared/lib/gesture/useSwipePages';
import { Badge } from '@/shared/ui/badge';
import { formatShort } from '../model/format';
import { countMessages, type MessageTab, tabOf } from './model/messages';

const TYPE_ICONS = {
  question: CircleHelpIcon,
  request: SendIcon,
} as const;

/**
 * The state of a listed message: unanswered, waiting to be picked up, or (a
 * question) answered and waiting for an AI to take the answer in.
 */
function StateBadge({ message }: { message: Message }) {
  const { t } = useTranslation();
  if (message.turn === 'human')
    return <Badge variant="pending">{t('messages.state.unanswered')}</Badge>;
  return (
    <Badge variant="muted">
      {message.type === 'question'
        ? t('messages.state.answerWaitingPickup')
        : t('messages.state.waitingPickup')}
    </Badge>
  );
}

/** One row: the kind, the direction, its state and the first line. */
function MessageRow({ message, onOpen }: { message: Message; onOpen: () => void }) {
  const { t } = useTranslation();
  const Icon = TYPE_ICONS[message.type];
  return (
    <li>
      <button
        type="button"
        className="message-row"
        data-type={message.type}
        disabled={onOpen === undefined}
        onClick={onOpen}
      >
        <span className="message-row__icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="message-row__main">
          <span className="message-row__meta">
            <span>{t(`messages.type.${message.type}`)}</span>
            <span>
              {message.to === 'human' ? t('messages.list.toYou') : t('messages.list.toAi')}
            </span>
            <span className="message-row__id">{message.id}</span>
            <span>{formatShort(message.createdAt)}</span>
          </span>
          <span className="message-row__title">{message.title}</span>
        </span>
        <StateBadge message={message} />
      </button>
    </li>
  );
}

const TABS: readonly MessageTab[] = ['fromAi', 'fromYou'];

/** Newest first, whatever order the project lists them in. */
function rowsOf(messages: readonly Message[], tab: MessageTab) {
  return messages
    .filter((message) => tabOf(message) === tab)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function Rows({ rows, onOpen }: { rows: readonly Message[]; onOpen: (message: Message) => void }) {
  const { t } = useTranslation();
  if (rows.length === 0) return <p className="message-list__empty">{t('messages.list.empty')}</p>;
  return (
    <ul className="message-list__rows">
      {rows.map((message) => (
        <MessageRow key={message.id} message={message} onOpen={() => onOpen(message)} />
      ))}
    </ul>
  );
}

/**
 * The two tabs' rows side by side: a sideways swipe moves to the other tab, and the tab marker
 * follows the finger. A tap on a row, a vertical scroll and the sheet's own drag are left alone.
 */
function SwipeRows({
  messages,
  tab,
  onTabChange,
  onOpen,
  tabsRef,
}: {
  messages: readonly Message[];
  tab: MessageTab;
  onTabChange: (tab: MessageTab) => void;
  onOpen: (message: Message) => void;
  tabsRef: RefObject<HTMLElement | null>;
}) {
  const viewportRef = useSwipePages(TABS, tab, onTabChange, {
    progressTarget: tabsRef,
    progressVar: '--tab-progress',
    ignore: () => Boolean(window.getSelection()?.toString()),
  });
  return (
    <div
      className="message-list__viewport"
      ref={viewportRef}
      data-base-ui-swipe-ignore=""
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onTouchCancel={(event) => event.stopPropagation()}
    >
      <div className="message-list__track">
        {TABS.map((id) => (
          <div
            key={id}
            className="message-list__page"
            role="tabpanel"
            aria-hidden={id !== tab}
            inert={id !== tab}
          >
            <Rows rows={rowsOf(messages, id)} onOpen={onOpen} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The list of open messages in two tabs; on a phone the tabs also switch by a sideways swipe. */
export function MessageList({
  messages,
  tab,
  onTabChange,
  onOpen,
  swipe = false,
}: {
  messages: readonly Message[];
  tab: MessageTab;
  onTabChange: (tab: MessageTab) => void;
  /** A question or a request was chosen. */
  onOpen: (message: Message) => void;
  /** Switches the tabs by a sideways swipe (a phone). */
  swipe?: boolean;
}) {
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabs: { id: MessageTab; label: string }[] = [
    { id: 'fromAi', label: t('messages.list.tabFromAi') },
    { id: 'fromYou', label: t('messages.list.tabFromYou') },
  ];
  // A tab counts what waits: an answer no AI took in yet is listed but not counted.
  const count = countMessages(messages);
  return (
    <div className="message-list">
      <div
        className="message-tabs"
        data-swipe={swipe || undefined}
        ref={tabsRef}
        role="tablist"
        aria-label={t('messages.list.tabs')}
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="message-tabs__tab"
            aria-selected={item.id === tab}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
            <strong>{count[item.id]}</strong>
          </button>
        ))}
      </div>
      {swipe ? (
        <SwipeRows
          messages={messages}
          tab={tab}
          onTabChange={onTabChange}
          onOpen={onOpen}
          tabsRef={tabsRef}
        />
      ) : (
        <Rows rows={rowsOf(messages, tab)} onOpen={onOpen} />
      )}
    </div>
  );
}
