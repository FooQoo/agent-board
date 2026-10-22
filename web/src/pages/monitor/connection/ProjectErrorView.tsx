import { CircleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Header } from '../../../shared/ui/app-header/Header';
import { monitorLogo } from '../logo';
import './connection-state.css';

/**
 * Why the monitor has no project to show. The address names no project (`missing`), names
 * something that is not a project (`invalid`), or names a project the PC no longer has
 * (`notFound`). It never falls back to another project or to a list.
 */
export type ProjectErrorKind = 'missing' | 'invalid' | 'notFound';

/** The phone screen shown instead of the monitor when its address does not lead to a project. */
export function ProjectErrorView({ kind }: { kind: ProjectErrorKind }) {
  const { t } = useTranslation();
  return (
    <main className="monitor-shell">
      <Header logoSrc={monitorLogo} settingsSize="l" />
      <section className="connection-state" role="alert">
        <CircleAlertIcon className="connection-state__icon" aria-hidden="true" strokeWidth={1.5} />
        <h2 className="connection-state__title">
          {t(`dataLayerMonitor.projectError.${kind}.title`)}
        </h2>
        <p className="connection-state__body">{t(`dataLayerMonitor.projectError.${kind}.body`)}</p>
        <p className="connection-state__body">{t('dataLayerMonitor.projectError.guide')}</p>
      </section>
    </main>
  );
}
