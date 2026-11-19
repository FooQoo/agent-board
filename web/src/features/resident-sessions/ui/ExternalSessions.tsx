import { useTranslation } from 'react-i18next';
import { formatTime } from '@/shared/lib/time/formatTime';
import type { AttachedSession } from '../api';

/** The sessions started outside the board that are connected to it; collapsed until asked for. */
export function ExternalSessions({
  sessions,
  open,
}: {
  sessions: readonly AttachedSession[];
  open: boolean;
}) {
  const { t } = useTranslation();
  return (
    <details className="resident-external" open={open || undefined}>
      <summary>{t('resident.externalTitle', { count: sessions.length })}</summary>
      <p className="resident-external__hint">{t('resident.externalHint')}</p>
      {sessions.length === 0 ? (
        <p className="resident-note">{t('resident.externalNone')}</p>
      ) : (
        <ul className="resident-external__list">
          {sessions.map((session) => (
            <li key={session.id}>
              <span>{t(`resident.externalTool.${session.tool}`)}</span>
              <span>
                {t('resident.externalSince', { time: formatTime(new Date(session.connectedAt)) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
