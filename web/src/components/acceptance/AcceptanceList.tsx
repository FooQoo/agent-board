import type { AcceptanceItem } from '../../types';
import './acceptance.css';

/** Shared read-only rows and progress meter; the host owns tabs, folding and scrolling. */
export function AcceptanceList({
  items,
  progressItems = items,
}: {
  items: readonly AcceptanceItem[];
  progressItems?: readonly AcceptanceItem[];
}) {
  return (
    <div className="acceptance-list">
      <div className="acceptance-view__meter" aria-hidden="true">
        {progressItems.map((item) => (
          <span
            key={item.id}
            className={item.done ? 'acceptance-view__segment is-done' : 'acceptance-view__segment'}
          />
        ))}
      </div>
      <ul className="acceptance-view__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={item.done ? 'acceptance-view__item is-done' : 'acceptance-view__item'}
          >
            <input type="checkbox" checked={item.done} disabled readOnly aria-label={item.text} />
            <span className="acceptance-view__id">{item.id}</span>
            <span className="acceptance-view__text">{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
