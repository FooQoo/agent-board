import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesSurface } from '../../features/tasks/messages/MessagesSurface';
import { countMessages, firstQuestionOfTask } from '../../features/tasks/messages/model/messages';
import { useMessagesPanel } from '../../features/tasks/messages/useMessagesPanel';
import type { ColumnName, ProjectId } from '../../shared/api/contracts';
import { TaskStatusChangedError } from '../../features/tasks/api/lifecycle';
import { TransientNotice } from '../../shared/ui/transient-notice/TransientNotice';
import type { Message } from '../../shared/data/api/contracts';
import { Header } from '../../shared/ui/app-header/Header';
import { savingSettingsSlot, sheetSettingsSlot } from '../../features/settings/ui/settingsSlot';
import type { MonitorTask, MonitorViewProps } from './contracts';
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
  const { t } = useTranslation();
  // Without an endpoint (the sample-data mode, the demo) the choices stay in this browser.
  const { preferences, settings: given } = props;
  const settings = useMemo(
    () => given ?? (preferences ? savingSettingsSlot(preferences, 'sheet') : sheetSettingsSlot),
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
  };
  const { onDetailOpenChange } = props;
  useEffect(() => {
    onDetailOpenChange?.(detail.open);
    return () => onDetailOpenChange?.(false);
  }, [detail.open, onDetailOpenChange]);
  // `?messages=summary` opens the list on the Summary tab once; closing it ends the request.
  const { summaryLink, onSummaryLinkClose } = props;
  const summaryOpened = useRef(false);
  const { open: openPanel } = panel;
  const panelClosed = panel.target === null;
  useEffect(() => {
    if (!summaryLink || !props.messagesApi) return;
    if (!summaryOpened.current) {
      summaryOpened.current = true;
      openPanel({ tab: 'summary' });
    } else if (panelClosed) {
      summaryOpened.current = false;
      onSummaryLinkClose?.();
    }
  }, [summaryLink, props.messagesApi, openPanel, panelClosed, onSummaryLinkClose]);
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
  const archiveSheet = useArchiveSheet(pending?.kind === 'list', projectId, writes, onWritten);
  const [notice, setNotice] = useState<string | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  // A move by a person is made at once, with no dialog. A task that moved meanwhile is not moved.
  const moveNow = async (item: MonitorTask, target: ColumnName) => {
    if (!writes) return;
    try {
      await writes.move(projectId, item.task.id, target, item.task.taskStatus);
      overlay.move(item.task.id, target);
    } catch (cause) {
      setNotice(
        cause instanceof TaskStatusChangedError
          ? t('moveNotice.statusChanged', { status: t(`column.${cause.current}`) })
          : t('moveNotice.failed'),
      );
    } finally {
      onWritten?.();
    }
  };
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
        onMove={(item, target) => void moveNow(item, target)}
        onArchive={(item) => ask({ kind: 'archive', item })}
        onOpenDetail={(item, tab) => {
          detail.show(item, tab);
          props.onOpenDetail?.(item, tab);
        }}
        onRefresh={props.onRefresh}
        refreshing={props.refreshing}
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
          {...archiveSheet}
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
