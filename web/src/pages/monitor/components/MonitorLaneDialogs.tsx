import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import type { ColumnName } from '../../../shared/api/contracts';
import { BulkArchiveDialog } from '../../../features/tasks/archive/BulkArchiveDialog';
import { DeleteConfirm } from '../../../features/tasks/delete/DeleteConfirm';
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
 * of a card, the move dialog with its reason, and the bulk archive of the done lane. The archive
 * question sits in a dialog here, because on a phone there is no detail panel to hold it.
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
        onConfirm={onBulkArchive}
        onCancel={onCancel}
      />
    );
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="lane-confirm" showCloseButton={false}>
        <DialogTitle className="sr-only">{t('archive.buttonLabel')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('archive.confirm', { id: pending.item.task.id, title: pending.item.task.title })}
        </DialogDescription>
        <DeleteConfirm
          task={pending.item.task}
          action="archive"
          saving={false}
          focusOnMount
          onCancel={onCancel}
          onConfirm={() => onArchive(pending.item)}
        />
      </DialogContent>
    </Dialog>
  );
}
