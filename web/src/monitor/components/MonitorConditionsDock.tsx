import { useTranslation } from 'react-i18next';
import type { AcceptanceItem } from '../../types';

/**
 * The completion conditions of a card or epic, at the bottom of the mobile drawer outside its tab
 * panels. Folded by default; nothing is shown for a card without conditions.
 */
export function MonitorConditionsDock({ acceptance }: { acceptance: readonly AcceptanceItem[] }) {
  const { t } = useTranslation();
  if (acceptance.length === 0) return null;
  return (
    <section className="monitor-conditions-dock" aria-label={t('acceptance.title')}>
      <details className="monitor-document__acceptance">
        <summary>
          <span>{t('acceptance.title')}</span>
          <span>
            {t('acceptance.progress', {
              done: acceptance.filter((item) => item.done).length,
              total: acceptance.length,
            })}
          </span>
        </summary>
        <ul>
          {acceptance.map((item) => (
            <li key={item.id}>
              <input type="checkbox" checked={item.done} disabled readOnly aria-label={item.text} />
              <span>{item.id}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
