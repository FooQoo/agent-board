import { useTranslation } from 'react-i18next';
import { BulkArchiveDialog } from '../../../features/tasks/archive/BulkArchiveDialog';
import type { MonitorTask } from '../contracts';
import { ArchiveListSheet, type ArchiveSheetData } from './ArchiveListSheet';
import './monitor-lanes.css';

/** The confirmation the lane view is waiting on: nothing changes until the person agrees. A move asks nothing. */
export type LanePending =
  | { kind: 'archive'; item: MonitorTask }
  | { kind: 'bulk' }
  /** The list of archived tasks, opened from the bar's Archive item. */
  | { kind: 'list'; armed?: number; revealed?: boolean }
  | null;

/** The bar item a sheet of the lanes belongs to. */
export function pendingNavItem(pending: LanePending): 'archive' | 'bulkArchive' | null {
  if (pending?.kind === 'list') return 'archive';
  return pending?.kind === 'bulk' ? 'bulkArchive' : null;
}

export interface MonitorLaneDialogsProps {
  pending: LanePending;
  projectName: string;
  /** The cards of the done lane, as the bulk confirmation lists them. */
  doneItems: readonly MonitorTask[];
  onCancel: () => void;
  /** Resolves with false (or throws) when it failed, and the confirmation says so. */
  onArchive: (item: MonitorTask) => Promise<boolean>;
  onBulkArchive: () => Promise<void>;
  /** What the archive list shows; without it the list is not offered. */
  archive?: ArchiveSheetData;
  /** Restores a task from the archive list to the lane it was archived from. */
  onRestore?: (taskId: number) => Promise<void>;
}

/**
 * The sheets of the lane view above the board: the archive question of a card and the bulk archive
 * of the done lane (each the one the PC board uses), and the list of archived tasks. Archiving one card asks in the same dialog as the
 * bulk archive, listing that card alone, so both read alike.
 */
export function MonitorLaneDialogs({
  pending,
  projectName,
  doneItems,
  onCancel,
  onArchive,
  onBulkArchive,
  archive,
  onRestore,
}: MonitorLaneDialogsProps) {
  const { t } = useTranslation();
  if (pending === null) return null;
  if (pending.kind === 'list')
    return archive && onRestore ? (
      <ArchiveListSheet
        {...archive}
        initialArmed={pending.armed ?? null}
        initialRevealed={pending.revealed}
        onRestore={onRestore}
        onClose={onCancel}
      />
    ) : null;
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
