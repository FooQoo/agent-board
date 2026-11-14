import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import { DataProvider, usePresentationHold, useSummary } from '../../shared/data/react';
import type { ConnectionState, DataAdapter } from '../../shared/data/core';
import { applyPreferenceEvent, syncPreferences } from '../../shared/preferences';
import type {
  AnswersWriter,
  BandQuestion,
  QuestionReader,
} from '../../features/tasks/answer/model/qa';
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
  /** Reads one question of the project for the answer sheet. */
  readQuestion: QuestionReader;
  writeAnswers: AnswersWriter;
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
  readQuestion,
  writeAnswers,
  useBuildReload,
  onNotFound,
  build,
  stream,
}: MonitorProjectProps & { build: string | null; stream: ConnectionState }) {
  const summary = useSummary(projectId);
  const answers = useMonitorInteractions();
  const [detailOpen, setDetailOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);

  // A drawer, and an answer on its way, keep the list as it is; the data layer applies what
  // arrived 3 seconds after they are gone. An answer sheet that is only open holds nothing: the
  // question is replaced or withdrawn in it as it happens. Reloading for a new build waits for the
  // drawer, a send, and any input left in memory, which a reload would lose.
  usePresentationHold(detailOpen, 'drawer');
  usePresentationHold(answers.sending, 'answer');
  useBuildReload(build, answers.sending || detailOpen || answers.held);

  const gone = monitorErrorStatus(summary.error) === 404;
  useEffect(() => {
    if (gone) onNotFound();
  }, [gone, onNotFound]);

  const data = summary.summary;
  useEffect(() => {
    if (data !== null) setLastFetchedAt(new Date().toISOString());
  }, [data]);

  const tasks = useMemo(() => (data === null ? [] : monitorTasksOf(data)), [data]);
  const questions = useMemo<BandQuestion[] | null>(
    () =>
      data?.questions?.map(({ id, title, referencedBy }) => ({ id, title, referencedBy })) ?? null,
    [data],
  );
  const { book } = answers;
  // A held question that leaves the open list is closed; reading it says why.
  useEffect(() => {
    if (questions === null) return;
    for (const id of book.reconcile(projectId, questions))
      readQuestion(projectId, id).then(
        (detail) => {
          if (detail.status !== 'open') book.markClosed(projectId, id, detail.status);
        },
        () => {},
      );
  }, [book, projectId, questions, readQuestion]);

  const freshness = monitorFreshness({
    state: summary.state,
    hasData: data !== null,
    problems: data?.problems ?? [],
    projectId,
    stream,
    lastFetchedAt,
  });
  const visible = selectMonitorTasks(tasks);
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
    answerController: { book, read: readQuestion, write: writeAnswers },
    projectId,
    questions: questions ?? undefined,
    // Answers are shown at once: the Summary is read again without waiting for the hold.
    onAnswersSent: () => void summary.refresh(),
    readResolvers: monitorReadResolvers,
    freshness,
    onRefresh: () => void refresh(),
    refreshing: refreshing || summary.state === 'refreshing',
    onDetailOpenChange: setDetailOpen,
  };
  return <MonitorView {...props} />;
}
