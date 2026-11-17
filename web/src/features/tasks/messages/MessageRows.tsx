import { ClipboardCheckIcon, CircleHelpIcon, SendIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Message } from '@/shared/data/api/contracts';
import { Badge } from '@/shared/ui/badge';
import { formatShort } from '../model/format';
import { type MessageTab, tabOf } from './model/messages';

const TYPE_ICONS = {
  question: CircleHelpIcon,
  request: SendIcon,
  approval: ClipboardCheckIcon,
} as const;

/** The state of an open message: unanswered, awaiting approval, or waiting to be picked up. */
function StateBadge({ message }: { message: Message }) {
  const { t } = useTranslation();
  if (message.turn === 'human')
    return (
      <Badge variant="pending">
        {message.type === 'approval'
          ? t('messages.state.awaitingApproval')
          : t('messages.state.unanswered')}
      </Badge>
    );
  return <Badge variant="muted">{t('messages.state.waitingPickup')}</Badge>;
}

/** One row: the kind, the direction, its state and the first line. */
function MessageRow({
  message,
  onOpen,
}: {
  message: Message;
  /** Without it the row cannot be opened (an approval whose review is not wired). */
  onOpen?: () => void;
}) {
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
  onOpenApproval,
}: {
  messages: readonly Message[];
  tab: MessageTab;
  onTabChange: (tab: MessageTab) => void;
  /** A question or a request was chosen. */
  onOpen: (message: Message) => void;
  /** An approval was chosen: its review opens elsewhere. */
  onOpenApproval?: (message: Message) => void;
}) {
  const { t } = useTranslation();
  const tabs: { id: MessageTab; label: string }[] = [
    { id: 'fromAi', label: t('messages.list.tabFromAi') },
    { id: 'fromYou', label: t('messages.list.tabFromYou') },
  ];
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
            <strong>{messages.filter((message) => tabOf(message) === item.id).length}</strong>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="message-list__empty">{t('messages.list.empty')}</p>
      ) : (
        <ul className="message-list__rows">
          {rows.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              onOpen={
                message.type === 'approval'
                  ? onOpenApproval && (() => onOpenApproval(message))
                  : () => onOpen(message)
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
