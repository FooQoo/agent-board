import { useTranslation } from 'react-i18next';
import { attachedCounts } from '../state';
import type { ResidentPanelProps } from '../types';
import { PreviewNotice } from '@/shared/ui/preview-feature/PreviewNotice';
import { ExternalSessions } from './ExternalSessions';
import { StalledNotice } from './StalledNotice';
import { ResidentNotice } from './ResidentNotice';
import { SessionCard } from './SessionCard';
import './resident.css';

function Summary({ total, board, external }: { total: number; board: number; external: number }) {
  const { t } = useTranslation();
  return (
    <section className="resident-summary" aria-label={t('resident.title')}>
      <p className="resident-summary__main" role="status">
        {total > 0 ? t('resident.attachedNow', { count: total }) : t('resident.attachedNone')}
      </p>
      {total > 0 && (
        <p className="resident-summary__origins">
          {t('resident.originBoard', { count: board })} ·{' '}
          {t('resident.originExternal', { count: external })}
        </p>
      )}
    </section>
  );
}

/** The body of the dialog: the attached count, the one card, the warning and the external sessions. */
export function ResidentPanel(props: ResidentPanelProps) {
  const { t } = useTranslation();
  const counts = attachedCounts(props.snapshot);
  const external = props.snapshot.sessions.filter((session) => session.origin === 'external');
  return (
    <div className="resident-body">
      <p className="resident-intro">{t('resident.intro')}</p>
      <PreviewNotice feature="resident" />
      {props.loadFailed && (
        <p className="resident-error" role="status">
          {t('resident.loadFailed')}
        </p>
      )}
      <Summary {...counts} />
      <SessionCard {...props} />
      <StalledNotice health={props.snapshot.health} />
      <ResidentNotice />
      <ExternalSessions sessions={external} open={props.externalOpen ?? false} />
    </div>
  );
}
