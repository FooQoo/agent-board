import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import { httpStatusOf } from '../../shared/api/httpStatus';
import { DataProvider, usePresentationHold, useSummary } from '../../shared/data/react';
import type { ConnectionState, DataAdapter } from '../../shared/data/core';
import {
  applyPreferenceEvent,
  syncPreferences,
  type PreferencesEndpoint,
} from '../../shared/preferences';
import type { AnswerBook } from '../../features/tasks/answer/model/answerBook';
import type {
  AnswersWriter,
  BandQuestion,
  QuestionReader,
} from '../../features/tasks/answer/model/qa';
import type { PhoneGuideLink } from '../../features/onboarding/model/phoneGuideLink';
import type {
  MonitorHeaderProps,
  MonitorReadResolvers,
  MonitorViewProps,
  MonitorWrites,
} from './contracts';
import { MonitorView } from './View';
import { monitorFreshness } from './model/freshness';
import { selectMonitorTasks } from './model/select';
import { monitorTasksOf } from './model/summary';
import { useAnswerBookState, useMonitorInteractions } from './hooks/useMonitorInteractions';

/** A hook that reloads the page for a newer build (`served`), unless the page is `busy`. The entry supplies it. */
export type BuildReloadHook = (served: string | null, busy: boolean) => void;

/**
 * What the screen takes from the app that shows it: where attachments are read and which
 * acceptance condition write it uses, where the language and theme are saved, and how a question
 * is read for the answer sheet. The monitor app and the board app each give their own.
 */
export interface MonitorEnvironment {
  readResolvers: MonitorReadResolvers;
  /** Where the language and theme are saved; `undefined` keeps them in this browser only. */
  preferences?: PreferencesEndpoint;
  /** Reads one question of the project for the answer sheet. */
  readQuestion: QuestionReader;
  writeAnswers: AnswersWriter;
  /** Moves and archives from the lanes; without them the lanes only read. */
  writes?: MonitorWrites;
}

export interface MonitorScreenProps extends MonitorEnvironment {
  projectId: ProjectId;
  /** The held answers. The app owns it, so they outlive this screen. */
  book: AnswerBook;
  useBuildReload: BuildReloadHook;
  /** The build the server named; `null` when the app reloads for a new build itself. */
  build: string | null;
  stream: ConnectionState;
  /** The project is gone: the app replaces the screen. */
  onNotFound(): void;
  /** The header's project switcher, when the app offers one. */
  header?: MonitorHeaderProps;
  /** The first-run guide's link to this screen, when the app runs the guide. */
  guideLink?: PhoneGuideLink;
}

export interface MonitorProjectProps extends MonitorEnvironment {
  projectId: ProjectId;
  /** How this project is read. Stable for the life of the screen. */
  adapter: DataAdapter;
  useBuildReload: BuildReloadHook;
  /** The project is gone: the screen is replaced by the error screen, which also ends the stream. */
  onNotFound(): void;
}

/**
 * One project on the phone, in the monitor app. It brings its own data layer and book of held
 * answers; the board app draws `MonitorScreen` inside its own.
 */
export function MonitorProject(props: MonitorProjectProps) {
  const [build, setBuild] = useState<string | null>(null);
  const [stream, setStream] = useState<ConnectionState>('connecting');
  const { preferences } = props;
  const onReady = useCallback(
    (served: string) => {
      setBuild(served);
      // The saved language and theme come from the PC each time the stream is ready.
      if (preferences) void syncPreferences(preferences);
    },
    [preferences],
  );
  const onPreferences = useCallback((event: unknown) => applyPreferenceEvent(event as Event), []);
  const { book } = useMonitorInteractions();
  return (
    <DataProvider
      adapter={props.adapter}
      onReady={onReady}
      onPreferences={onPreferences}
      onConnectionState={setStream}
    >
      <MonitorScreen {...props} book={book} build={build} stream={stream} />
    </DataProvider>
  );
}

/**
 * The phone screen of one project, drawn from the Summary the data layer above it holds, with the
 * Details a person opened.
 */
export function MonitorScreen({
  projectId,
  book,
  readQuestion,
  writeAnswers,
  readResolvers,
  preferences,
  useBuildReload,
  onNotFound,
  build,
  stream,
  header,
  guideLink,
  writes,
}: MonitorScreenProps) {
  const summary = useSummary(projectId);
  const answers = useAnswerBookState(book);
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

  const gone = httpStatusOf(summary.error) === 404;
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
    readResolvers,
    preferences,
    header,
    guideLink,
    freshness,
    onRefresh: () => void refresh(),
    refreshing: refreshing || summary.state === 'refreshing',
    onDetailOpenChange: setDetailOpen,
    writes,
    projectName: header?.projects?.find((project) => project.id === projectId)?.name ?? '',
    onWritten: () => void summary.refresh(),
  };
  return <MonitorView {...props} />;
}
