import { useTranslation } from 'react-i18next';
import { formatShort } from '../lib/format';
import { type HistoryItem, historyItems } from '../lib/history';
import type { HistoryEvent } from '../types';
import { AssigneeLabel } from './AssigneeLabel';
import { StatusLabel } from './StatusLabel';

/** Lane moves and creation use the card status color; run state changes use the new run state. */
function dotTone(item: HistoryItem): string {
  if (item.statusKind === 'card') return item.cardStatus;
  return item.status === 'running' ? 'doing' : item.status;
}

export function HistoryTimeline({ events }: { events: HistoryEvent[] }) {
  const { t } = useTranslation();
  const items = historyItems(events);
  return (
    <ol className="history">
      {items.map((item) => (
        <li key={item.id} className="history__step" data-column={item.cardStatus}>
          <span
            className="dot dot--history"
            data-column={item.cardStatus}
            data-tone={dotTone(item)}
            aria-hidden="true"
          />
          <span className="history__text">
            <span className="history__at">
              {item.created ? `${t('history.created')} · ` : ''}
              {formatShort(item.at)}
            </span>
            <span className="history__heading">
              <StatusLabel kind={item.statusKind} status={item.status} />
              <AssigneeLabel assignee={item.actor} />
            </span>
            {item.choice && <span className="history__choice">{item.choice}</span>}
            {item.reason && <span className="history__reason">{item.reason}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
