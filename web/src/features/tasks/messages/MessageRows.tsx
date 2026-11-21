import { CircleHelpIcon, SendIcon } from 'lucide-react';
import { type RefObject, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '@/shared/data/api/contracts';
import {
  type PullState,
  REFRESHING_HEIGHT,
  usePullToRefresh,
} from '@/shared/lib/gesture/usePullToRefresh';
import { useSwipePages } from '@/shared/lib/gesture/useSwipePages';
import { Badge } from '@/shared/ui/badge';
import { PullIndicator } from '@/shared/ui/pull/PullIndicator';
import { formatShort } from '../model/format';
import { countMessages, type MessageKindTab, type MessageTab, tabOf } from './model/messages';
import { SummaryList } from './SummaryList';
import type { SummariesController } from './useSummaries';

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

const KIND_TABS: readonly MessageTab[] = ['fromAi', 'fromYou'];
const ALL_TABS: readonly MessageTab[] = ['fromAi', 'fromYou', 'summary'];

/** Newest first, whatever order the project lists them in. */
function rowsOf(messages: readonly Message[], tab: MessageKindTab) {
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
  tabs,
  onTabChange,
  onOpen,
  tabsRef,
  summaries,
  variant,
}: {
  messages: readonly Message[];
  tab: MessageTab;
  tabs: readonly MessageTab[];
  onTabChange: (tab: MessageTab) => void;
  onOpen: (message: Message) => void;
  tabsRef: RefObject<HTMLElement | null>;
  summaries?: SummariesController;
  variant: 'dialog' | 'sheet';
}) {
  const viewportRef = useSwipePages(tabs, tab, onTabChange, {
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
        {tabs.map((id) => (
          <div
            key={id}
            className="message-list__page"
            role="tabpanel"
            aria-hidden={id !== tab}
            inert={id !== tab}
          >
            {id === 'summary' ? (
              summaries && <SummaryList controller={summaries} variant={variant} />
            ) : (
              <Rows rows={rowsOf(messages, id)} onOpen={onOpen} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The list of open messages in two tabs; the tabs also switch by a sideways swipe. */
export function MessageList({
  messages,
  tab,
  onTabChange,
  onOpen,
  swipe = false,
  summaries,
  kind = 'dialog',
  onRefresh,
  refreshing,
  previewPull,
}: {
  messages: readonly Message[];
  tab: MessageTab;
  onTabChange: (tab: MessageTab) => void;
  /** A question or a request was chosen. */
  onOpen: (message: Message) => void;
  /** Switches the tabs by a sideways swipe (the phone sheet and the PC modal). */
  swipe?: boolean;
  /** The periodic summaries; with them the list has a third tab. */
  summaries?: SummariesController;
  /** A modal on the PC (trash button beside each summary) or a phone sheet (swipe to trash). */
  kind?: 'dialog' | 'sheet';
  /** Pulling the list down from its top refreshes; without this the list cannot be pulled. */
  onRefresh?: () => void;
  /** The refresh the person asked for is running. */
  refreshing?: boolean;
  /** A story's still picture: the list shows this pull state. */
  previewPull?: Exclude<PullState, 'idle'>;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const pull = usePullToRefresh({
    container: listRef,
    scroller: (root) => root.closest<HTMLElement>('.surface__body'),
    onRefresh,
    refreshing,
  });
  const shown =
    previewPull === undefined
      ? pull
      : { state: previewPull, offset: previewPull === 'refreshing' ? REFRESHING_HEIGHT : 40 };
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabs: { id: MessageTab; label: string }[] = [
    { id: 'fromAi', label: t('messages.list.tabFromAi') },
    { id: 'fromYou', label: t('messages.list.tabFromYou') },
    ...(summaries ? [{ id: 'summary' as const, label: t('messages.summary.tab') }] : []),
  ];
  const tabIds = summaries ? ALL_TABS : KIND_TABS;
  // A tab counts what waits: an answer no AI took in yet is listed but not counted.
  const count = {
    ...countMessages(messages),
    summary: summaries?.summaries.length ?? 0,
  };
  return (
    <div className="message-list" ref={listRef}>
      <div
        className="message-tabs"
        data-swipe={swipe || undefined}
        data-tabs={tabs.length}
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
      <PullIndicator state={shown.state} offset={shown.offset} />
      {swipe ? (
        <SwipeRows
          messages={messages}
          tab={tab}
          tabs={tabIds}
          onTabChange={onTabChange}
          onOpen={onOpen}
          tabsRef={tabsRef}
          summaries={summaries}
          variant={kind}
        />
      ) : tab === 'summary' ? (
        summaries && <SummaryList controller={summaries} variant={kind} />
      ) : (
        <Rows rows={rowsOf(messages, tab)} onOpen={onOpen} />
      )}
    </div>
  );
}
