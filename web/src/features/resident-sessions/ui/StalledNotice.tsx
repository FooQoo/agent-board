import { CirclePauseIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SessionHealth } from '../api';
import type { StalledItem } from '../api';

/** The name of an item as a person reads it: "Request Q-3", "Answer to Q-5", "Task #12". */
export function useStalledName() {
  const { t } = useTranslation();
  return (item: StalledItem): string => t(`resident.stalledItem.${item.kind}`, { id: item.id });
}

/** Items the board gave up on after a failed turn, apart from those left on hold by clean turns. */
export function splitStalled(health: SessionHealth): {
  failed: StalledItem[];
  onHold: StalledItem[];
} {
  return {
    failed: health.pushStalled.filter((item) => !item.onHold),
    onHold: health.pushStalled.filter((item) => item.onHold),
  };
}

/**
 * Items the board handed over several times without a change. Items whose turns failed are a
 * warning with the way out; items the turns left as they were are on hold, in neutral wording.
 */
export function StalledNotice({ health }: { health: SessionHealth }) {
  const { t } = useTranslation();
  const name = useStalledName();
  const { failed, onHold } = splitStalled(health);
  if (failed.length === 0 && onHold.length === 0) return null;
  return (
    <>
      {failed.length > 0 && (
        <section className="resident-notice resident-stalled" role="alert">
          <TriangleAlertIcon aria-hidden="true" />
          <div>
            <p className="resident-stalled__title">{t('resident.stalledTitle')}</p>
            <ul className="resident-stalled__list">
              {failed.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <span>{name(item)}</span>
                  {item.lastError && (
                    <span className="resident-stalled__reason">{item.lastError}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="resident-stalled__hint">{t('resident.stalledHint')}</p>
          </div>
        </section>
      )}
      {onHold.length > 0 && (
        <section className="resident-notice resident-hold" role="status">
          <CirclePauseIcon aria-hidden="true" />
          <div>
            <p className="resident-stalled__title">{t('resident.holdTitle')}</p>
            <ul className="resident-stalled__list">
              {onHold.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <span>{name(item)}</span>
                </li>
              ))}
            </ul>
            <p className="resident-stalled__hint">{t('resident.holdHint')}</p>
          </div>
        </section>
      )}
    </>
  );
}
