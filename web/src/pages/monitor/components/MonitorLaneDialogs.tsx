import { useTranslation } from 'react-i18next';
import type { ColumnName } from '../../../shared/api/contracts';
import { BulkArchiveDialog } from '../../../features/tasks/archive/BulkArchiveDialog';
import { MoveDialog } from '../../../features/tasks/move/MoveDialog';
import type { MonitorTask } from '../contracts';
import './monitor-lanes.css';

/** The confirmation the lane view is waiting on: nothing changes until the person agrees. */
export type LanePending =
  | { kind: 'archive'; item: MonitorTask }
  | { kind: 'move'; item: MonitorTask; target: ColumnName }
  | { kind: 'bulk' }
  | null;

export interface MonitorLaneDialogsProps {
  pending: LanePending;
  projectName: string;
  /** The cards of the done lane, as the bulk confirmation lists them. */
  doneItems: readonly MonitorTask[];
  onCancel: () => void;
  /** Resolves with false (or throws) when it failed, and the confirmation says so. */
  onArchive: (item: MonitorTask) => Promise<boolean>;
  onMove: (
    item: MonitorTask,
    target: ColumnName,
    data: { reason: string; fromStatus: ColumnName },
  ) => Promise<void>;
  onBulkArchive: () => Promise<void>;
}

/**
 * The three confirmations of the lane view, each the one the PC board uses: the archive question
 * of a card, the move dialog with its reason, and the bulk archive of the done lane. Archiving one
 * card asks in the same dialog as the bulk archive, listing that card alone, so both read alike.
 */
export function MonitorLaneDialogs({
  pending,
  projectName,
  doneItems,
  onCancel,
  onArchive,
  onMove,
  onBulkArchive,
}: MonitorLaneDialogsProps) {
  const { t } = useTranslation();
  if (pending === null) return null;
  if (pending.kind === 'move')
    return (
      <MoveDialog
        task={pending.item.task}
        target={pending.target}
        onClose={onCancel}
        onSubmit={(data) => onMove(pending.item, pending.target, data)}
      />
    );
  if (pending.kind === 'bulk')
    return (
      <BulkArchiveDialog
        projectName={projectName}
        targets={doneItems.map((item) => item.task)}
        saving={false}
        kind="sheet"
        onConfirm={onBulkArchive}
        onCancel={onCancel}
      />
    );
  const item = pending.item;
  return (
    <BulkArchiveDialog
      projectName={projectName}
      targets={[item.task]}
      saving={false}
      title={t('monitor.lanes.archiveTitle')}
      description={t('monitor.lanes.archiveDescription', {
        id: item.task.id,
        title: item.task.title,
      })}
      submitLabel={t('monitor.lanes.archiveSubmit')}
      onConfirm={async () => {
        if (!(await onArchive(item))) throw new Error(t('archive.error'));
      }}
      onCancel={onCancel}
    />
  );
}
