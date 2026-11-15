import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Header } from '../../shared/ui/app-header/Header';
import { savingSettingsSlot, settingsSlot } from '../../features/settings/ui/settingsSlot';
import type { MonitorViewProps } from './contracts';
import { TaskList } from './components/TaskList';
import { Freshness } from './components/Freshness';
import { sortDone, sortLane } from './model/sort';
import { useMonitorDetailDrawer } from './hooks/useMonitorDetailDrawer';
import { unconnectedMonitorReadResolvers } from './contracts';
import { preloadable } from '../../shared/lib/lazy/preloadable';
import { QuestionBand } from '../../features/tasks/answer/QuestionBand';
import { firstQuestionOf } from '../../features/tasks/answer/model/qa';
import { type AnswerStart, answerStart } from '../../features/tasks/answer/answerStart';
import { OnboardingNotice } from '../../features/onboarding/ui/OnboardingNotice';
import { usePhoneGuideNotice } from '../../features/onboarding/model/phoneGuideLink';

/** The drawer, with the Markdown view, history and swipe code, loads after the list is shown. */
const detailDrawer = preloadable(() =>
  import('./components/MonitorDetailDrawer').then((module) => module.MonitorDetailDrawer),
);

/** The answer sheet, with its form and the Markdown view, loads after the list is shown too. */
const answerSheet = preloadable(() =>
  import('./components/MonitorAnswerSheet').then((module) => module.default),
);

/** Fetches the drawer's code; the view calls it once the list is shown. */
export const preloadMonitorDrawer = detailDrawer.preload;

export function MonitorView(props: MonitorViewProps) {
  const { t } = useTranslation();
  // Without an endpoint (the sample-data mode, the demo) the choices stay in this browser.
  const { preferences } = props;
  const settings = useMemo(
    () => (preferences ? savingSettingsSlot(preferences) : settingsSlot),
    [preferences],
  );
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A failed fetch is tried again when the drawer is first rendered.
    detailDrawer.preload().catch(() => {});
    answerSheet.preload().catch(() => {});
  }, []);
  // The sheet is drawn outside the cards: a card that moves or leaves does not close it.
  const [answering, setAnswering] = useState<{ start: AnswerStart; key: number } | null>(null);
  const [answerOpen, setAnswerOpen] = useState(false);
  const book = props.answerController?.book;
  const projectId = props.projectId ?? '';
  const openAnswer = (start: AnswerStart) => {
    setAnswering((current) => ({ start, key: (current?.key ?? 0) + 1 }));
    setAnswerOpen(true);
  };
  const { summary, todo, doing, done, freshness, guideLink } = props;
  const guideNotice = usePhoneGuideNotice(guideLink);
  // The first-run guide opens the sheet of a sample card, and learns whether the sheet is open.
  const answerRequest = useRef<(taskId: number) => void>(() => {});
  answerRequest.current = (taskId) => {
    const first = firstQuestionOf(props.questions ?? [], taskId);
    openAnswer(first ? answerStart.task(taskId) : answerStart.resume());
  };
  useEffect(
    () => guideLink?.onAnswerRequest((taskId) => answerRequest.current(taskId)),
    [guideLink],
  );
  useEffect(() => {
    guideLink?.setSheetOpen(answerOpen);
    return () => guideLink?.setSheetOpen(false);
  }, [guideLink, answerOpen]);
  const ordered = {
    todo: sortLane(todo),
    doing: sortLane(doing),
    done: sortDone(done),
  };
  const tasks = [...ordered.todo, ...ordered.doing, ...ordered.done];
  const detail = useMonitorDetailDrawer(tasks);
  const { onDetailOpenChange } = props;
  useEffect(() => {
    onDetailOpenChange?.(detail.open);
    return () => onDetailOpenChange?.(false);
  }, [detail.open, onDetailOpenChange]);
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
      <Header {...props.header} settings={settings} settingsSize="l" />
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
      {guideNotice !== null && <OnboardingNotice message={guideNotice} inline />}
      {props.answerController && props.projectId && props.questions && (
        <QuestionBand
          questions={props.questions.filter((question) => !book?.isSent(projectId, question.id))}
          held={new Set(book?.heldIds(projectId))}
          sendableCount={book?.sendableIds(projectId).length ?? 0}
          variant="phone"
          onOpen={(questionId) => openAnswer(answerStart.question(questionId))}
          onAnswer={() => openAnswer(answerStart.resume())}
          onReview={() => openAnswer(answerStart.review())}
        />
      )}
      <TaskList
        ref={listRef}
        id={listId}
        todo={ordered.todo}
        doing={ordered.doing}
        done={ordered.done}
        freshness={freshness}
        onOpenDetail={(item, tab) => {
          detail.show(item, tab);
          props.onOpenDetail?.(item, tab);
        }}
        onOpenAnswer={(item) => {
          const first = firstQuestionOf(props.questions ?? [], item.task.id);
          openAnswer(first ? answerStart.task(item.task.id) : answerStart.resume());
        }}
        answerController={props.answerController}
      />
      {props.answerController && props.projectId && answering && (
        <Suspense fallback={null}>
          <answerSheet.Component
            key={answering.key}
            projectId={props.projectId}
            questions={props.questions ?? []}
            items={tasks}
            start={answering.start}
            open={answerOpen}
            onOpenChange={setAnswerOpen}
            controller={props.answerController}
            resolvers={props.readResolvers ?? unconnectedMonitorReadResolvers}
            onSent={props.onAnswersSent ?? (() => {})}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <detailDrawer.Component
          item={detail.target}
          open={detail.open}
          tab={detail.tab}
          onOpenChange={detail.close}
          onTabChange={detail.setTab}
          resolvers={props.readResolvers ?? unconnectedMonitorReadResolvers}
          problems={freshness.snapshotProblems}
        />
      </Suspense>
      <Freshness
        state={freshness.state}
        lastFetchedAt={freshness.lastFetchedAt}
        problemCount={freshness.snapshotProblems.length}
        onRefresh={props.onRefresh}
        refreshing={props.refreshing}
      />
    </main>
  );
}
