import { columnLabel, formatShort } from '../lib/format';
import { historyItems } from '../lib/history';
import type { Transition } from '../types';

export function HistoryTimeline({ transitions }: { transitions: Transition[] }) {
  const items = historyItems(transitions);
  return (
    <ol className="history">
      {items.map((item, index) => (
        <li key={index} className="history__step" data-column={item.column}>
          <span className="dot dot--history" data-column={item.column} aria-hidden="true" />
          <span className="history__text">
            <span className="history__column">{columnLabel(item.column)}</span>
            <span className="history__at">
              {item.label !== null ? `${item.label} · ` : ''}
              {formatShort(item.at)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
