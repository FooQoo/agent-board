import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SessionHealth } from '../api';
import type { StalledItem } from '../api';

/** The name of an item as a person reads it: "Request Q-3", "Answer to Q-5", "Task #12". */
export function useStalledName() {
  const { t } = useTranslation();
  return (item: StalledItem): string => t(`resident.stalledItem.${item.kind}`, { id: item.id });
}

/** Items the board pushed to the session several times and gave up on, with the way out. */
export function StalledNotice({ health }: { health: SessionHealth }) {
  const { t } = useTranslation();
  const name = useStalledName();
  const items = health.pushStalled;
  if (items.length === 0) return null;
  return (
    <section className="resident-notice resident-stalled" role="alert">
      <TriangleAlertIcon aria-hidden="true" />
      <div>
        <p className="resident-stalled__title">{t('resident.stalledTitle')}</p>
        <ul className="resident-stalled__list">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <span>{name(item)}</span>
              {item.lastError && <span className="resident-stalled__reason">{item.lastError}</span>}
            </li>
          ))}
        </ul>
        <p className="resident-stalled__hint">{t('resident.stalledHint')}</p>
      </div>
    </section>
  );
}
