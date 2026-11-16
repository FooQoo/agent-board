import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Header } from '../../shared/ui/app-header/Header';
import { savingSettingsSlot, settingsSlot } from '../../features/settings/ui/settingsSlot';
import type { MonitorViewProps } from './contracts';
import { LaneTabs } from './components/LaneTabs';
import { MonitorLanes } from './components/MonitorLanes';
import { type LanePending, MonitorLaneDialogs } from './components/MonitorLaneDialogs';
import type { MonitorSection } from './components/MonitorSectionHeader';
import './components/monitor-lanes.css';
import { Freshness } from './components/Freshness';
import { sortDone, sortLane } from './model/sort';
import { useMonitorDetailDrawer } from './hooks/useMonitorDetailDrawer';
import { useLaneOverlay } from './hooks/useLaneOverlay';
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
  // Without an endpoint (the sample-data mode, the demo) the choices stay in this browser.
  const { preferences, settings: given } = props;
  const settings = useMemo(
    () => given ?? (preferences ? savingSettingsSlot(preferences) : settingsSlot),
    [given, preferences],
  );
  const lanesId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [lane, setLane] = useState<MonitorSection>('todo');
  const [pending, setPending] = useState<LanePending>(null);
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
  const { todo, doing, done, freshness, guideLink } = props;
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
  // Kept between renders, so the lanes see a new order only when the project is read again.
  const read = useMemo(
    () => ({ todo: sortLane(todo), doing: sortLane(doing), done: sortDone(done) }),
    [todo, doing, done],
  );
  // What this phone saved stays on screen until a read shows it, so nothing jumps back and forth.
  const overlay = useLaneOverlay(read);
  const ordered = overlay.lanes;
  const tasks = [...ordered.todo, ...ordered.doing, ...ordered.done];
  const detail = useMonitorDetailDrawer(tasks);
  const { onDetailOpenChange } = props;
  useEffect(() => {
    onDetailOpenChange?.(detail.open);
    return () => onDetailOpenChange?.(false);
  }, [detail.open, onDetailOpenChange]);
  const { writes, onWritten } = props;
  // Without writes (the demo, sample data) a swipe asks nothing and changes nothing.
  const ask = (next: LanePending) => {
    if (writes) setPending(next);
  };
  const closePending = () => setPending(null);
  return (
    <main className="monitor-shell">
      <Header {...props.header} settings={settings} settingsSize="l" />
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
      <LaneTabs
        ref={tabsRef}
        lane={lane}
        controlsId={lanesId}
        counts={{
          todo: ordered.todo.length,
          doing: ordered.doing.length,
          done: ordered.done.length,
        }}
        onLaneChange={setLane}
      />
      <MonitorLanes
        id={lanesId}
        tabsRef={tabsRef}
        lanes={ordered}
        lane={lane}
        onLaneChange={setLane}
        onMove={(item, target) => ask({ kind: 'move', item, target })}
        onArchive={(item) => ask({ kind: 'archive', item })}
        onBulkArchive={() => ask({ kind: 'bulk' })}
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
      {writes && (
        <MonitorLaneDialogs
          pending={pending}
          projectName={props.projectName ?? ''}
          doneItems={ordered.done}
          onCancel={closePending}
          onArchive={async (item) => {
            try {
              await writes.archive(projectId, item.task.id);
            } catch {
              return false;
            }
            overlay.hide([item.task.id]);
            closePending();
            onWritten?.();
            return true;
          }}
          onMove={async (item, target, data) => {
            try {
              await writes.move(projectId, item.task.id, target, data.reason, data.fromStatus);
              overlay.move(item.task.id, target);
            } finally {
              onWritten?.();
            }
            closePending();
          }}
          onBulkArchive={async () => {
            try {
              const ids = ordered.done.map((item) => item.task.id);
              await writes.archiveDone(projectId, ids);
              overlay.hide(ids);
            } finally {
              onWritten?.();
            }
            closePending();
          }}
        />
      )}
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
