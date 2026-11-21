import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOpenOnSend } from './useOpenOnSend';
import { MessagesSurface } from '../../features/tasks/messages/MessagesSurface';
import { countMessages, firstQuestionOfTask } from '../../features/tasks/messages/model/messages';
import { useMessagesPanel } from '../../features/tasks/messages/useMessagesPanel';
import type { ProjectId } from '../../shared/api/contracts';
import { BacklogSendLayer } from '../../features/backlog/BacklogSendLayer';
import { useBacklogSend } from '../../features/backlog/useBacklogSend';
import { TransientNotice } from '../../shared/ui/transient-notice/TransientNotice';
import type { Message } from '../../shared/data/api/contracts';
import { Header } from '../../shared/ui/app-header/Header';
import { savingSettingsSlot, sheetSettingsSlot } from '../../features/settings/ui/settingsSlot';
import type { MonitorViewProps } from './contracts';
import { LaneTabs } from './components/LaneTabs';
import { PhoneNav } from './components/PhoneNav';
import { MonitorLanes } from './components/MonitorLanes';
import {
  type LanePending,
  MonitorLaneDialogs,
  pendingNavItem,
} from './components/MonitorLaneDialogs';
import type { MonitorSection } from './components/MonitorSectionHeader';
import './components/monitor-lanes.css';
import { Freshness } from './components/Freshness';
import { useArchiveSheet } from './hooks/useArchiveSheet';
import { sortDone, sortLane } from './model/sort';
import { useMonitorDetailDrawer } from './hooks/useMonitorDetailDrawer';
import { useResultLinkDrawer } from './hooks/useResultLinkDrawer';
import { useLaneOverlay } from './hooks/useLaneOverlay';
import { useReportOpen } from './hooks/useReportOpen';
import { useLaneWrites } from './hooks/useLaneWrites';
import { useSummaryLinkOpen } from './hooks/useSummaryLinkOpen';
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
    () => given ?? (preferences ? savingSettingsSlot(preferences, 'sheet') : sheetSettingsSlot),
    [given, preferences],
  );
  const lanesId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [lane, setLane] = useState<MonitorSection>('doing'); // opens on Doing, whatever lanes come before it
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
  const { backlog, todo, doing, done, freshness, guideLink } = props;
  // A guide step is about the cards of one lane: that lane comes on screen.
  const guideLane = usePhoneGuideLane(guideLink);
  useEffect(() => {
    if (guideLane) setLane(guideLane);
  }, [guideLane]);
  // Kept between renders, so the lanes see a new order only when the project is read again.
  const read = useMemo(
    () => ({
      backlog: sortLane(backlog),
      todo: sortLane(todo),
      doing: sortLane(doing),
      done: sortDone(done),
    }),
    [backlog, todo, doing, done],
  );
  // What this phone saved stays on screen until a read shows it, so nothing jumps back and forth.
  const overlay = useLaneOverlay(read);
  const ordered = overlay.lanes;
  const tasks = [...ordered.backlog, ...ordered.todo, ...ordered.doing, ...ordered.done];
  const detail = useMonitorDetailDrawer(tasks);
  const { resultLink, onResultLinkClose } = props;
  useResultLinkDrawer(
    tasks,
    resultLink ?? null,
    detail.show,
    props.messagesApi
      ? {
          messages: props.messages,
          open: (messageId) => panel.open({ tab: 'fromAi', openId: messageId }),
        }
      : undefined,
  );
  const closeDrawer = (next: boolean) => {
    detail.close(next);
    if (!next && resultLink != null) onResultLinkClose?.();
    if (!next) panel.returnToList(); // back to the Summary list a result was opened from
  };
  useReportOpen(detail.open, props.onDetailOpenChange);
  useSummaryLinkOpen(
    panel,
    props.summaryLink,
    props.messagesApi !== undefined,
    props.onSummaryLinkClose,
  );
  const { open: openPanel } = panel;
  useReportOpen(panel.target !== null, props.onMessagesOpenChange);
  // A sent request opens the list on "Your requests".
  const openRequests = useCallback(() => openPanel({ tab: 'fromYou' }), [openPanel]);
  useOpenOnSend(props.requestSent ?? 0, props.messagesApi !== undefined, openRequests);
  const { writes, onWritten } = props;
  // Without writes (the demo, sample data) a swipe asks nothing and changes nothing.
  const ask = (next: LanePending) => {
    if (writes) setPending(next);
  };
  const closePending = () => setPending(null);
  // The phone's bar stays tappable over a sheet, so a tap on it closes the sheets it is not opening.
  // Leaving Ask goes through its discard question: `next` runs only once the Ask sheet has closed.
  const leaveAsk = (next: () => void) =>
    props.asking && props.onAskClose ? props.onAskClose(next) : next();
  const closeSheets = ({ except }: { except?: 'messages' | 'ask' | 'archive' | 'bulk' }) => {
    if (except !== 'messages') panel.close();
    if (except !== 'archive' && except !== 'bulk') closePending();
    if (detail.open) closeDrawer(false);
  };
  // The archive is read only while its list is open, and again after each restore.
  const archiveSheet = useArchiveSheet(
    pending?.kind === 'list',
    projectId,
    writes,
    onWritten,
    overlay.unhide,
  );
  const backlogSend = useBacklogSend(
    writes ? (projectId as ProjectId) : null,
    tasks.map((item) => item.task),
    () => onWritten?.(),
  );
  const { moveNow, archiveOne, archiveAll, notice, dismissNotice } = useLaneWrites({
    writes,
    projectId,
    overlay,
    doneItems: ordered.done,
    closePending,
    onWritten,
  });
  return (
    <main className="monitor-shell">
      <Header {...props.header} withSettings={false} />
      {panel.target !== null && props.messagesApi && props.projectId && props.messages && (
        <MessagesSurface
          projectId={props.projectId}
          messages={props.messages}
          kind="sheet"
          target={panel.target}
          api={props.messagesApi}
          onChanged={props.onMessagesChanged ?? (() => {})}
          onClose={panel.close}
          onLeaveForResult={panel.leaveForResult}
          onRefresh={props.onRefresh}
          refreshing={props.refreshing}
          resolveAttachment={resolveAttachment}
        />
      )}
      <LaneTabs
        ref={tabsRef}
        lane={lane}
        controlsId={lanesId}
        counts={{
          backlog: ordered.backlog.length,
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
        onMove={(item, target) => void moveNow(item, target)}
        onArchive={(item) => ask({ kind: 'archive', item })}
        onOpenDetail={(item, tab) => {
          detail.show(item, tab);
          props.onOpenDetail?.(item, tab);
        }}
        onRefresh={props.onRefresh}
        refreshing={props.refreshing}
        onSend={writes ? backlogSend.request : undefined}
        sendBusy={backlogSend.busy}
        onBulkArchive={
          writes
            ? () =>
                leaveAsk(() => {
                  closeSheets({ except: 'bulk' });
                  ask({ kind: 'bulk' });
                })
            : undefined
        }
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
      <TransientNotice message={notice} onDismiss={dismissNotice} />
      <BacklogSendLayer send={backlogSend} kind="sheet" />
      {writes && (
        <MonitorLaneDialogs
          pending={pending}
          projectName={props.projectName ?? ''}
          doneItems={ordered.done}
          onCancel={closePending}
          onArchive={archiveOne}
          {...archiveSheet}
          onBulkArchive={archiveAll}
        />
      )}
      <Suspense fallback={null}>
        <detailDrawer.Component
          item={detail.target}
          open={detail.open}
          tab={detail.tab}
          onOpenChange={closeDrawer}
          focusResultVersion={
            resultLink != null && detail.target?.task.id === resultLink.taskId
              ? resultLink.version
              : null
          }
          onTabChange={detail.setTab}
          resolvers={props.readResolvers ?? unconnectedMonitorReadResolvers}
          problems={freshness.snapshotProblems}
        />
      </Suspense>
      <Freshness
        state={freshness.state}
        lastFetchedAt={freshness.lastFetchedAt}
        problemCount={freshness.snapshotProblems.length}
        slot={props.statusSlot}
      />
      <PhoneNav
        settings={settings}
        questionCount={countMessages(props.messages ?? []).fromAi}
        archiveDisabled={!writes}
        open={
          panel.target !== null
            ? 'messages'
            : (pendingNavItem(pending) ?? (props.asking ? 'ask' : null))
        }
        // The bar stays in front of an open sheet: an item closes the other sheets, then opens its own.
        onMessages={() =>
          leaveAsk(() => {
            closeSheets({ except: 'messages' });
            panel.open({ tab: 'fromAi' });
          })
        }
        onAsk={() => {
          closeSheets({ except: 'ask' });
          props.onAsk?.();
        }}
        onArchive={() =>
          leaveAsk(() => {
            closeSheets({ except: 'archive' });
            ask({ kind: 'list' });
          })
        }
        onBoard={(then) =>
          leaveAsk(() => {
            closeSheets({});
            then?.();
          })
        }
      />
    </main>
  );
}
