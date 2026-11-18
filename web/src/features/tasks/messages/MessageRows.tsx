import { CircleHelpIcon, SendIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Message } from '@/shared/data/api/contracts';
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

/** The list of open messages in two tabs. */
export function MessageList({
  messages,
  tab,
  onTabChange,
  onOpen,
}: {
  messages: readonly Message[];
  tab: MessageTab;
  onTabChange: (tab: MessageTab) => void;
  /** A question or a request was chosen. */
  onOpen: (message: Message) => void;
}) {
  const { t } = useTranslation();
  const tabs: { id: MessageTab; label: string }[] = [
    { id: 'fromAi', label: t('messages.list.tabFromAi') },
    { id: 'fromYou', label: t('messages.list.tabFromYou') },
  ];
  // A tab counts what waits: an answer no AI took in yet is listed but not counted.
  const count = countMessages(messages);
  // Newest first, whatever order the project lists them in.
  const rows = messages
    .filter((message) => tabOf(message) === tab)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="message-list">
      <div className="message-tabs" role="tablist" aria-label={t('messages.list.tabs')}>
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
      {rows.length === 0 ? (
        <p className="message-list__empty">{t('messages.list.empty')}</p>
      ) : (
        <ul className="message-list__rows">
          {rows.map((message) => (
            <MessageRow key={message.id} message={message} onOpen={() => onOpen(message)} />
          ))}
        </ul>
      )}
    </div>
  );
}
