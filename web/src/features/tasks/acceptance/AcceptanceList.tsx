import type { AcceptanceItem } from '../../../shared/api/contracts';
import './acceptance.css';

/**
 * Shared rows and progress meter; the host owns tabs, folding and scrolling. Read-only unless the host
 * passes `onToggle`; then each checkbox can be changed, except the ones in `busy` while they save.
 */
export function AcceptanceList({
  items,
  progressItems = items,
  onToggle,
  busy,
}: {
  items: readonly AcceptanceItem[];
  progressItems?: readonly AcceptanceItem[];
  onToggle?: (item: AcceptanceItem, done: boolean) => void;
  busy?: ReadonlySet<string>;
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
            {onToggle ? (
              <input
                type="checkbox"
                checked={item.done}
                disabled={busy?.has(item.id) ?? false}
                aria-label={item.text}
                onChange={(event) => onToggle(item, event.currentTarget.checked)}
              />
            ) : (
              <input type="checkbox" checked={item.done} disabled readOnly aria-label={item.text} />
            )}
            <span className="acceptance-view__id">{item.id}</span>
            <span className="acceptance-view__text">{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
