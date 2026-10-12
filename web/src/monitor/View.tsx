import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Header } from '../components/Header';
import { ProjectSwitcher } from '../components/ProjectSwitcher';
import type { MonitorViewProps } from './contracts';
import { CardList } from './components/CardList';
import { Freshness } from './components/Freshness';
import { sortDone, sortLane } from './model/sort';

export function MonitorView(props: MonitorViewProps) {
  const { t } = useTranslation();
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const { projects, scope, summary, todo, doing, done, freshness, onScopeChange } = props;
  const ordered = {
    todo: sortLane(todo),
    doing: sortLane(doing),
    done: sortDone(done),
  };
  const scopeName =
    scope === 'all'
      ? t('monitor.allProjects')
      : (projects.find((project) => project.id === scope)?.name ?? t('monitor.allProjects'));
  // While the shared files are partly damaged the server summary is missing; the tiles then show a dash, not a zero.
  const tile = (n: number) => (summary === null ? '—' : n);
  const goTo = (section: string) => {
    const target = listRef.current?.querySelector<HTMLElement>(
      `[data-monitor-section="${section}"]`,
    );
    target?.scrollIntoView?.({ block: 'start' });
    target?.focus?.({ preventScroll: true });
  };
  return (
    <main className="monitor-shell">
      <Header />
      <div className="monitor-controls">
        <ProjectSwitcher
          projects={projects}
          activeProjectId={scope}
          allProjects
          allProjectsLabel={t('monitor.allProjects')}
          onSelect={onScopeChange}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="monitor-refresh"
          aria-label={t('monitor.refresh')}
          onClick={props.onRefresh}
        >
          ↻
        </Button>
      </div>
      {props.routeNotice && (
        <p className="monitor-route-notice" role="status">
          {t('monitor.invalidSelection')}
        </p>
      )}
      <section className="monitor-summary" aria-label={t('monitor.summary')}>
        <button type="button" onClick={() => goTo('todo')} aria-controls={listId}>
          <strong>{tile(ordered.todo.length)}</strong>
          <span>{t('monitor.status.todo')}</span>
        </button>
        <button type="button" onClick={() => goTo('doing')} aria-controls={listId}>
          <strong>{tile(ordered.doing.length)}</strong>
          <span>{t('monitor.status.doing')}</span>
        </button>
        <button type="button" onClick={() => goTo('done')} aria-controls={listId}>
          <strong>{tile(ordered.done.length)}</strong>
          <span>{t('monitor.status.done')}</span>
        </button>
      </section>
      <CardList
        ref={listRef}
        id={listId}
        todo={ordered.todo}
        doing={ordered.doing}
        done={ordered.done}
        scopeName={scopeName}
        freshness={freshness}
        onOpenDetail={props.onOpenDetail}
      />
      <Freshness
        state={freshness.state}
        lastFetchedAt={freshness.lastFetchedAt}
        failedCount={freshness.failedProjectIds.length}
        problemCount={freshness.snapshotProblems.length}
        onRefresh={props.onRefresh}
        compact
      />
    </main>
  );
}
