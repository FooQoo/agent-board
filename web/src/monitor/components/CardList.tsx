import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonitorCard } from '../contracts';
import type { MonitorFreshness } from '../contracts';
import { MonitorCard as CardRow } from './MonitorCard';
import { MonitorSectionHeader, type MonitorSection } from './MonitorSectionHeader';

/** Each card is in exactly one section; the view decides which (see MonitorView). */
export type Sections = Record<MonitorSection, MonitorCard[]>;
export const CardList = forwardRef<
  HTMLDivElement,
  Sections & {
    id: string;
    scopeName: string;
    freshness: MonitorFreshness;
  }
>(function CardList({ id, pending, running, todo, doing, done, freshness }, ref) {
  const { t } = useTranslation();
  const sections: Array<[MonitorSection, MonitorCard[]]> = [
    ['pending', pending],
    ['running', running],
    ['todo', todo],
    ['doing', doing],
    ['done', done],
  ];
  return (
    <div className="monitor-list" id={id} ref={ref} role="region" aria-label={t('monitor.cards')}>
      {freshness.state === 'loading' && (
        <p className="monitor-empty">{t('monitor.freshness.loading')}</p>
      )}
      {sections.map(([section, items]) => (
        <section
          key={section}
          className="monitor-list__section"
          data-monitor-section={section}
          tabIndex={-1}
        >
          <MonitorSectionHeader
            section={section}
            count={freshness.state === 'loading' ? '—' : items.length}
          />
          {freshness.state === 'loading' ? null : items.length === 0 ? (
            <p className="monitor-empty">{t(`monitor.empty.${section}`)}</p>
          ) : (
            <div className="monitor-list__cards">
              {items.map((item) => (
                <CardRow key={`${item.projectId}:${item.card.id}`} item={item} section={section} />
              ))}
            </div>
          )}
        </section>
      ))}
      {freshness.state === 'error' && (
        <p className="monitor-empty">{t('monitor.freshness.error')}</p>
      )}
    </div>
  );
});
