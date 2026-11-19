import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { MessageCenter } from '../../features/tasks/messages/MessageCenter';
import { firstQuestionOfTask } from '../../features/tasks/messages/model/messages';
import { useMessagesPanel } from '../../features/tasks/messages/useMessagesPanel';
import type { ProjectId } from '../../shared/api/contracts';
import type { Message } from '../../shared/data/api/contracts';
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
import { usePhoneGuideLane } from '../../features/onboarding/model/phoneGuideLink';

/** The drawer, with the Markdown view, history and swipe code, loads after the list is shown. */
const detailDrawer = preloadable(() =>
  import('./components/MonitorDetailDrawer').then((module) => module.MonitorDetailDrawer),
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
  }, []);
  // The list is drawn outside the cards, so a card that moves or leaves does not close it.
  const panel = useMessagesPanel();
  const projectId = props.projectId ?? '';
  const attachments = props.readResolvers?.attachmentUrl;
  const resolveAttachment =
    attachments && props.projectId
      ? (message: Message, id: string) =>
          message.tasks[0] === undefined
            ? null
            : attachments(projectId as ProjectId, message.tasks[0], id)
      : undefined;
  const { todo, doing, done, freshness, guideLink } = props;
  // A guide step is about the cards of one lane: that lane comes on screen.
  const guideLane = usePhoneGuideLane(guideLink);
  useEffect(() => {
    if (guideLane) setLane(guideLane);
  }, [guideLane]);
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
  const { onMessagesOpenChange } = props;
  const listOpen = panel.target !== null;
  useEffect(() => {
    onMessagesOpenChange?.(listOpen);
    return () => onMessagesOpenChange?.(false);
  }, [listOpen, onMessagesOpenChange]);
  const { writes, onWritten } = props;
  // Without writes (the demo, sample data) a swipe asks nothing and changes nothing.
  const ask = (next: LanePending) => {
    if (writes) setPending(next);
  };
  const closePending = () => setPending(null);
  return (
    <main className="monitor-shell">
      <Header {...props.header} settings={settings} settingsSize="l" />
      {props.messagesApi && props.projectId && props.messages && (
        <MessageCenter
          projectId={props.projectId}
          messages={props.messages}
          variant="phone"
          panel={panel}
          api={props.messagesApi}
          onChanged={props.onMessagesChanged ?? (() => {})}
          onAsk={props.onAsk}
          resolveAttachment={resolveAttachment}
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
        onOpenAnswer={
          props.messagesApi
            ? (item) =>
                panel.open({
                  tab: 'fromAi',
                  openId: firstQuestionOfTask(props.messages ?? [], item.task.id)?.id ?? null,
                })
            : undefined
        }
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
        slot={props.statusSlot}
      />
    </main>
  );
}
