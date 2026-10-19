import { ListChecksIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { progressOf } from './model/acceptance';
import type { AcceptanceItem } from '../../../shared/api/contracts';
import './acceptance.css';
import { AcceptanceList } from './AcceptanceList';

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
      <AcceptanceList items={shown} progressItems={items} />
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
