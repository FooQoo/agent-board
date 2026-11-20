import { useEffect, useId, useRef, useState } from 'react';
import { Header } from '../../../shared/ui/app-header/Header';
import { sheetSettingsSlot } from '../../../features/settings/ui/settingsSlot';
import { MessagesSurface } from '../../../features/tasks/messages/MessagesSurface';
import {
  countMessages,
  firstQuestionOfTask,
} from '../../../features/tasks/messages/model/messages';
import { useMessagesPanel } from '../../../features/tasks/messages/useMessagesPanel';
import type { ColumnName } from '../../../shared/api/contracts';
import type { MonitorTask, MonitorViewProps } from '../contracts';
import { LaneTabs } from './LaneTabs';
import { PhoneNav } from './PhoneNav';
import type { ArchiveSheetData } from './ArchiveListSheet';
import { MonitorLaneDialogs, type LanePending, pendingNavItem } from './MonitorLaneDialogs';
import { MonitorLanes, type LaneItems, type MonitorLanesProps } from './MonitorLanes';
import type { MonitorSection } from './MonitorSectionHeader';
import './monitor-lanes.css';

export interface MonitorLanesScreenProps
  extends Pick<MonitorLanesProps, 'previewRevealed' | 'previewPull' | 'onRefresh' | 'refreshing'> {
  lanes: LaneItems;
  projectName: string;
  /** The lane the screen opens on. After that the tabs and the swipes own it. */
  initialLane?: MonitorSection;
  /** A confirmation the screen opens with (a story's still picture of it). */
  initialPending?: LanePending;
  header?: MonitorViewProps['header'];
  /** The messages band, as on the list screen: shown when the first three are given. */
  projectId?: MonitorViewProps['projectId'];
  messages?: MonitorViewProps['messages'];
  messagesApi?: MonitorViewProps['messagesApi'];
  /** The list opens at the target the screen starts with (a story's still picture of it). */
  initialPanel?: Parameters<ReturnType<typeof useMessagesPanel>['open']>[0];
  onAsk?: MonitorViewProps['onAsk'];
  onOpenDetail?: MonitorViewProps['onOpenDetail'];
  /** The writes. A move is made at once; an archive is asked for only after the person confirmed. */
  onMove: (item: MonitorTask, target: ColumnName) => Promise<void>;
  onArchive: (item: MonitorTask) => Promise<boolean>;
  onBulkArchive: () => Promise<void>;
  /** The archive list the bar's Archive item opens, and the write that restores from it. */
  archive?: ArchiveSheetData;
  onRestore?: (taskId: number) => Promise<void>;
}

/**
 * The phone monitor with one lane on screen: header, the questions band, the lane tabs, the lanes
 * and their archive confirmations. It holds the lane on screen and the confirmation that is open, and
 * leaves the data and the writes to its parent. It is not connected to the live monitor yet.
 */
export function MonitorLanesScreen({
  lanes,
  projectName,
  initialLane = 'todo',
  initialPending = null,
  header,
  projectId,
  messages,
  messagesApi,
  initialPanel,
  onAsk,
  onOpenDetail,
  onMove,
  onArchive,
  onBulkArchive,
  archive,
  onRestore,
  previewRevealed,
  previewPull,
  onRefresh,
  refreshing,
}: MonitorLanesScreenProps) {
  const lanesId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [lane, setLane] = useState<MonitorSection>(initialLane);
  const [pending, setPending] = useState<LanePending>(initialPending);
  const panel = useMessagesPanel();
  const { open: openPanel } = panel;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list opens once, as the screen does.
  useEffect(() => {
    if (initialPanel) openPanel(initialPanel);
  }, []);
  const close = () => setPending(null);
  return (
    <main className="monitor-shell">
      <Header {...header} withSettings={false} />
      {panel.target !== null && messagesApi && projectId && messages && (
        <MessagesSurface
          projectId={projectId}
          messages={messages}
          kind="sheet"
          target={panel.target}
          api={messagesApi}
          onChanged={() => {}}
          onClose={panel.close}
        />
      )}
      <LaneTabs
        ref={tabsRef}
        lane={lane}
        controlsId={lanesId}
        counts={{
          todo: lanes.todo.length,
          doing: lanes.doing.length,
          done: lanes.done.length,
        }}
        onLaneChange={setLane}
      />
      <MonitorLanes
        id={lanesId}
        tabsRef={tabsRef}
        lanes={lanes}
        lane={lane}
        onLaneChange={setLane}
        onMove={(item, target) => void onMove(item, target)}
        onArchive={(item) => setPending({ kind: 'archive', item })}
        onOpenDetail={onOpenDetail}
        onBulkArchive={() => {
          panel.close();
          setPending({ kind: 'bulk' });
        }}
        onOpenAnswer={
          messagesApi
            ? (item) =>
                panel.open({
                  tab: 'fromAi',
                  openId: firstQuestionOfTask(messages ?? [], item.task.id)?.id ?? null,
                })
            : undefined
        }
        previewRevealed={previewRevealed}
        previewPull={previewPull}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
      <PhoneNav
        settings={sheetSettingsSlot}
        questionCount={countMessages(messages ?? []).fromAi}
        archiveDisabled={archive === undefined}
        open={panel.target !== null ? 'messages' : pendingNavItem(pending)}
        onMessages={() => {
          close();
          panel.open({ tab: 'fromAi' });
        }}
        onAsk={() => {
          panel.close();
          close();
          onAsk?.();
        }}
        onArchive={() => {
          panel.close();
          setPending({ kind: 'list' });
        }}
        onBoard={(then) => {
          panel.close();
          close();
          then?.();
        }}
      />
      <MonitorLaneDialogs
        pending={pending}
        projectName={projectName}
        doneItems={lanes.done}
        onCancel={close}
        archive={archive}
        onRestore={onRestore}
        onArchive={async (item) => {
          const ok = await onArchive(item);
          if (ok) close();
          return ok;
        }}
        onBulkArchive={async () => {
          await onBulkArchive();
          close();
        }}
      />
    </main>
  );
}
