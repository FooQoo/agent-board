import { ListChecksIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { progressOf } from '../../lib/acceptance';
import type { AcceptanceItem } from '../../types';
import './acceptance.css';

/** Conditions shown before the list is folded; the button opens the rest. */
const SHOWN_FIRST = 5;

/**
 * The completion conditions of a card or epic, at the top of its body. Read-only: a person changes them in
 * the edit dialog, and agents check them after verifying.
 */
export function AcceptanceView({
  items,
  embedded = false,
}: {
  items: readonly AcceptanceItem[];
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const { done, total } = progressOf(items);
  const folded = !embedded && items.length > SHOWN_FIRST && !expanded;
  const shown = folded ? items.slice(0, SHOWN_FIRST) : items;
  return (
    <section
      className="acceptance-view"
      data-embedded={embedded ? 'true' : undefined}
      aria-label={t('acceptance.title')}
    >
      {!embedded && (
        <header className="acceptance-view__head">
          <ListChecksIcon aria-hidden="true" focusable="false" />
          <h3 className="acceptance-view__title">{t('acceptance.title')}</h3>
          <span className="acceptance-view__count">
            {t('acceptance.progress', { done, total })}
          </span>
        </header>
      )}
      <div className="acceptance-view__meter" aria-hidden="true">
        {items.map((item) => (
          <span
            key={item.id}
            className={item.done ? 'acceptance-view__segment is-done' : 'acceptance-view__segment'}
          />
        ))}
      </div>
      <ul className="acceptance-view__list">
        {shown.map((item) => (
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
      {!embedded && items.length > SHOWN_FIRST && (
        <button
          type="button"
          className="acceptance-view__toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t('acceptance.showFewer') : t('acceptance.showAll', { count: items.length })}
        </button>
      )}
      <p className="acceptance-view__note">{t('acceptance.savedIn')}</p>
    </section>
  );
}
