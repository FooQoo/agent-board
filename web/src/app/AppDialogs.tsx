import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { actionDialog, bulkArchiveDialog, docsDialog } from './dialogs/lazyDialogs';
import type { AppDialogsProps } from './contracts';

export function AppDialogs({
  model,
  onSubmit,
  onCloseOperation,
  onSavingChange,
  onOpenTask,
  onConfirmBulkArchive,
  onCancelBulkArchive,
  epicApi,
}: AppDialogsProps) {
  const { t } = useTranslation();
  const { session, tasks, boardData, board, projects } = model;
  const dialog = session.dialog;
  const operation = session.operation;
  const bulkArchive = session.bulkArchive;

  return (
    <>
      {dialog && operation ? (
        <Suspense fallback={null}>
          <actionDialog.Component
            key={`${operation.id}:${operation.projectId}`}
            action={dialog}
            projectId={operation.projectId}
            onClose={onCloseOperation}
            onSavingChange={onSavingChange}
            tasks={tasks}
            epics={boardData?.epics ?? []}
            epicsFetchFailed={board.fetchFailed}
            epicApi={dialog.kind === 'epic' ? epicApi : undefined}
            onOpenTask={onOpenTask}
            onSubmit={onSubmit}
          />
        </Suspense>
      ) : null}
      {model.docsProjectId !== null ? (
        <Suspense fallback={null}>
          <docsDialog.Component
            key={model.docsProjectId}
            projectId={model.docsProjectId}
            onClose={() => model.setDocsProjectId(null)}
          />
        </Suspense>
      ) : null}
      {bulkArchive ? (
        <Suspense fallback={null}>
          <bulkArchiveDialog.Component
            projectName={
              projects.projects.find((project) => project.id === bulkArchive.projectId)?.name ??
              t('project.none')
            }
            targets={bulkArchive.targets}
            saving={session.operation?.kind === 'archive-done' && session.operation.saving}
            onCancel={onCancelBulkArchive}
            onConfirm={onConfirmBulkArchive}
          />
        </Suspense>
      ) : null}
    </>
  );
}
