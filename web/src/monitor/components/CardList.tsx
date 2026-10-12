import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonitorCard, MonitorFreshness, MonitorViewProps } from '../contracts';
import { MonitorCard as CardRow } from './MonitorCard';
import { MonitorSectionHeader, type MonitorSection } from './MonitorSectionHeader';

/** Each card is in exactly one section; the view decides which (see MonitorView). */
export type Sections = Record<MonitorSection, MonitorCard[]>;

export const CardList = forwardRef<
  HTMLDivElement,
  Pick<Sections, 'todo' | 'doing' | 'done'> & {
    id: string;
    scopeName: string;
    freshness: MonitorFreshness;
    onOpenDetail?: MonitorViewProps['onOpenDetail'];
    answerController?: MonitorViewProps['answerController'];
  }
>(function CardList({ id, todo, doing, done, freshness, onOpenDetail, answerController }, ref) {
  const { t } = useTranslation();
  const sections: Array<[MonitorSection, MonitorCard[]]> = [
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
                <CardRow
                  key={`${item.projectId}:${item.card.id}`}
                  item={item}
                  section={section}
                  onOpenDetail={onOpenDetail}
                  answerController={answerController}
                />
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
