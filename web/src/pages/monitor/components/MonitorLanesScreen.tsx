import { useId, useRef, useState } from 'react';
import { Header } from '../../../shared/ui/app-header/Header';
import { settingsSlot } from '../../../features/settings/ui/settingsSlot';
import { QuestionBand } from '../../../features/tasks/answer/QuestionBand';
import { type AnswerStart, answerStart } from '../../../features/tasks/answer/answerStart';
import type { ColumnName } from '../../../shared/api/contracts';
import type { MonitorTask, MonitorViewProps } from '../contracts';
import { LaneTabs } from './LaneTabs';
import { MonitorLaneDialogs, type LanePending } from './MonitorLaneDialogs';
import { MonitorLanes, type LaneItems, type MonitorLanesProps } from './MonitorLanes';
import type { MonitorSection } from './MonitorSectionHeader';
import './monitor-lanes.css';

export interface MonitorLanesScreenProps extends Pick<MonitorLanesProps, 'previewRevealed'> {
  lanes: LaneItems;
  projectName: string;
  /** The lane the screen opens on. After that the tabs and the swipes own it. */
  initialLane?: MonitorSection;
  /** A confirmation the screen opens with (a story's still picture of it). */
  initialPending?: LanePending;
  header?: MonitorViewProps['header'];
  /** The questions band, as on the list screen: shown when the first three are given. */
  projectId?: MonitorViewProps['projectId'];
  questions?: MonitorViewProps['questions'];
  answerController?: MonitorViewProps['answerController'];
  onAnswer?: (start: AnswerStart) => void;
  onOpenDetail?: MonitorViewProps['onOpenDetail'];
  /** The writes. The screen asks for them only after the person confirmed. */
  onMove: (
    item: MonitorTask,
    target: ColumnName,
    data: { reason: string; fromStatus: ColumnName },
  ) => Promise<void>;
  onArchive: (item: MonitorTask) => Promise<boolean>;
  onBulkArchive: () => Promise<void>;
}

/**
 * The phone monitor with one lane on screen: header, the questions band, the lane tabs, the lanes
 * and their confirmations. It holds the lane on screen and the confirmation that is open, and
 * leaves the data and the writes to its parent. It is not connected to the live monitor yet.
 */
export function MonitorLanesScreen({
  lanes,
  projectName,
  initialLane = 'todo',
  initialPending = null,
  header,
  projectId,
  questions,
  answerController,
  onAnswer,
  onOpenDetail,
  onMove,
  onArchive,
  onBulkArchive,
  previewRevealed,
}: MonitorLanesScreenProps) {
  const lanesId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [lane, setLane] = useState<MonitorSection>(initialLane);
  const [pending, setPending] = useState<LanePending>(initialPending);
  const book = answerController?.book;
  const answer = (start: AnswerStart) => onAnswer?.(start);
  const close = () => setPending(null);
  return (
    <main className="monitor-shell">
      <Header {...header} settings={settingsSlot} settingsSize="l" />
      {answerController && projectId && questions && (
        <QuestionBand
          questions={questions.filter((question) => !book?.isSent(projectId, question.id))}
          held={new Set(book?.heldIds(projectId))}
          sendableCount={book?.sendableIds(projectId).length ?? 0}
          variant="phone"
          onOpen={(questionId) => answer(answerStart.question(questionId))}
          onAnswer={() => answer(answerStart.resume())}
          onReview={() => answer(answerStart.review())}
        />
      )}
      <LaneTabs
        ref={tabsRef}
        lane={lane}
        controlsId={lanesId}
        counts={{ todo: lanes.todo.length, doing: lanes.doing.length, done: lanes.done.length }}
        onLaneChange={setLane}
      />
      <MonitorLanes
        id={lanesId}
        tabsRef={tabsRef}
        lanes={lanes}
        lane={lane}
        onLaneChange={setLane}
        onMove={(item, target) => setPending({ kind: 'move', item, target })}
        onArchive={(item) => setPending({ kind: 'archive', item })}
        onBulkArchive={() => setPending({ kind: 'bulk' })}
        onOpenDetail={onOpenDetail}
        onOpenAnswer={() => answer(answerStart.resume())}
        answerController={answerController}
        previewRevealed={previewRevealed}
      />
      <MonitorLaneDialogs
        pending={pending}
        projectName={projectName}
        doneItems={lanes.done}
        onCancel={close}
        onArchive={async (item) => {
          const ok = await onArchive(item);
          if (ok) close();
          return ok;
        }}
        onMove={async (item, target, data) => {
          await onMove(item, target, data);
          close();
        }}
        onBulkArchive={async () => {
          await onBulkArchive();
          close();
        }}
      />
    </main>
  );
}
