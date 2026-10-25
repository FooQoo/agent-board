import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import { DataProvider, usePresentationHold, useSummary } from '../../shared/data/react';
import type { ConnectionState, DataAdapter } from '../../shared/data/core';
import { applyPreferenceEvent, syncPreferences } from '../../shared/preferences';
import type { AnswerWriter } from '../../features/tasks/answer/model/answer';
import { monitorErrorStatus, monitorReadResolvers } from './client';
import type { MonitorViewProps } from './contracts';
import { MonitorView } from './View';
import { monitorFreshness } from './model/freshness';
import { selectMonitorTasks } from './model/select';
import { monitorTasksOf } from './model/summary';
import { useMonitorInteractions } from './hooks/useMonitorInteractions';
import { monitorPreferences } from './preferences';

/** A hook that reloads the page for a newer build (`served`), unless the page is `busy`. The entry supplies it. */
export type BuildReloadHook = (served: string | null, busy: boolean) => void;

export interface MonitorProjectProps {
  projectId: ProjectId;
  /** How this project is read. Stable for the life of the screen. */
  adapter: DataAdapter;
  writeAnswer: AnswerWriter;
  useBuildReload: BuildReloadHook;
  /** The project is gone: the screen is replaced by the error screen, which also ends the stream. */
  onNotFound(): void;
}

/**
 * One project on the phone. The data layer holds its Summary and the Details a person opened;
 * everything on screen is drawn from them.
 */
export function MonitorProject(props: MonitorProjectProps) {
  const [build, setBuild] = useState<string | null>(null);
  const [stream, setStream] = useState<ConnectionState>('connecting');
  const onReady = useCallback((served: string) => {
    setBuild(served);
    // The saved language and theme come from the PC each time the stream is ready.
    void syncPreferences(monitorPreferences);
  }, []);
  const onPreferences = useCallback((event: unknown) => applyPreferenceEvent(event as Event), []);
  return (
    <DataProvider
      adapter={props.adapter}
      onReady={onReady}
      onPreferences={onPreferences}
      onConnectionState={setStream}
    >
      <MonitorBoard {...props} build={build} stream={stream} />
    </DataProvider>
  );
}

function MonitorBoard({
  projectId,
  writeAnswer,
  useBuildReload,
  onNotFound,
  build,
  stream,
}: MonitorProjectProps & { build: string | null; stream: ConnectionState }) {
  const summary = useSummary(projectId);
  const answers = useMonitorInteractions({ writeAnswer });
  const [detailOpen, setDetailOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);

  // A drawer, and an answer being written, keep the list as it is; the data layer applies what
  // arrived 3 seconds after they are gone. Reloading for a new build waits for the same.
  usePresentationHold(detailOpen, 'drawer');
  usePresentationHold(answers.locked, 'answer');
  useBuildReload(build, answers.locked || detailOpen);

  const gone = monitorErrorStatus(summary.error) === 404;
  useEffect(() => {
    if (gone) onNotFound();
  }, [gone, onNotFound]);

  const data = summary.summary;
  useEffect(() => {
    if (data !== null) setLastFetchedAt(new Date().toISOString());
  }, [data]);

  const tasks = useMemo(() => (data === null ? [] : monitorTasksOf(data)), [data]);
  useEffect(() => {
    answers.reconcileTasks(tasks);
  }, [answers.reconcileTasks, tasks]);

  const freshness = monitorFreshness({
    state: summary.state,
    hasData: data !== null,
    problems: data?.problems ?? [],
    projectId,
    stream,
    lastFetchedAt,
  });
  const visible = selectMonitorTasks(
    answers.tasksWithSavedAnswers(tasks, freshness.state === 'fresh'),
  );
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await summary.refresh();
    } finally {
      setRefreshing(false);
    }
  }, [summary.refresh]);
  const props: MonitorViewProps = {
    summary:
      data === null || freshness.state === 'partial'
        ? null
        : {
            todo: visible.todo.length,
            doing: visible.doing.length,
            done: visible.done.length,
          },
    ...visible,
    answerController: {
      ...answers,
      onAnswered: (item, requestId, result) => {
        answers.onAnswered(item, requestId, result);
        // An answer is shown at once: the Summary is read again without waiting for the hold.
        void summary.refresh();
      },
    },
    readResolvers: monitorReadResolvers,
    freshness,
    onRefresh: () => void refresh(),
    refreshing: refreshing || summary.state === 'refreshing',
    onDetailOpenChange: setDetailOpen,
  };
  return <MonitorView {...props} />;
}
