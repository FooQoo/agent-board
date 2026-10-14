import { formatShort } from '../lib/format';
import { historyItems } from '../lib/history';
import type { HistoryEvent } from '../types';

export function HistoryTimeline({ events }: { events: HistoryEvent[] }) {
  const items = historyItems(events);
  return (
    <ol className="history">
      {items.map((item, index) => (
        <li key={events.length - index - 1} className="history__step">
          <span className="dot dot--history" data-tone="idle" aria-hidden="true" />
          <span className="history__text">
            <span className="history__at">{formatShort(item.at)}</span>
            <span className="history__reason">{item.reason}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
