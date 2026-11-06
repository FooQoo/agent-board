import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import {
  actionDialog,
  bulkArchiveDialog,
  decisionAnswerDialog,
  docsDialog,
} from './dialogs/lazyDialogs';
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
  const answerTarget = model.answerTarget;

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
            subscribeChanges={model.subscribeChanges}
            loadTask={model.loadTask}
            loadEpic={model.loadEpic}
            isTaskListed={model.isTaskListed}
            onChanged={() => model.refreshProject(operation.projectId)}
          />
        </Suspense>
      ) : null}
      {answerTarget !== null ? (
        <Suspense fallback={null}>
          <decisionAnswerDialog.Component
            key={`${answerTarget.projectId}:${answerTarget.taskId}`}
            projectId={answerTarget.projectId}
            taskId={answerTarget.taskId}
            task={tasks.find((task) => task.id === answerTarget.taskId) ?? null}
            answers={model.answerSession}
            operations={model.operations}
            syncedAt={board.lastSyncedAt}
            onAnswerChanged={() => model.refreshProject(answerTarget.projectId)}
            onClose={model.closeAnswer}
          />
        </Suspense>
      ) : null}
      {model.docsProjectId !== null ? (
        <Suspense fallback={null}>
          <docsDialog.Component
            key={model.docsProjectId}
            projectId={model.docsProjectId}
            onClose={() => model.setDocsProjectId(null)}
            subscribeChanges={model.subscribeDocs}
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
