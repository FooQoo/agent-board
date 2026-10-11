import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Header } from '../components/Header';
import { ProjectSwitcher } from '../components/ProjectSwitcher';
import type { MonitorViewProps } from './contracts';
import { CardList } from './components/CardList';
import { Freshness } from './components/Freshness';
import { sortDone, sortPending, sortRunning } from './model/sort';

export function MonitorView(props: MonitorViewProps) {
  const { t } = useTranslation();
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const { projects, scope, summary, pending, running, done, freshness, onScopeChange } = props;
  const ordered = {
    pending: sortPending(pending),
    running: sortRunning(running),
    done: sortDone(done),
  };
  const scopeName =
    scope === 'all'
      ? t('monitor.allProjects')
      : (projects.find((project) => project.id === scope)?.name ?? t('monitor.allProjects'));
  const count = (key: 'pending' | 'running' | 'done', fallback: number) =>
    summary === null ? '—' : (summary[key] ?? fallback);
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
        <button type="button" onClick={() => goTo('running')} aria-controls={listId}>
          <strong>{count('running', ordered.running.length)}</strong>
          <span>{t('monitor.status.running')}</span>
        </button>
        <button type="button" onClick={() => goTo('pending')} aria-controls={listId}>
          <strong>{count('pending', ordered.pending.length)}</strong>
          <span>{t('monitor.status.pending')}</span>
        </button>
        <button type="button" onClick={() => goTo('done')} aria-controls={listId}>
          <strong>{count('done', ordered.done.length)}</strong>
          <span>{t('monitor.status.done')}</span>
        </button>
      </section>
      <CardList
        ref={listRef}
        id={listId}
        pending={ordered.pending}
        running={ordered.running}
        done={ordered.done}
        scopeName={scopeName}
        freshness={freshness}
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
