import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppControllerModel, AppWorkspaceActions } from './contracts';
import {
  WriteError,
  createNewTask,
  createSimpleTaskMultipart,
  editTask,
  editTaskMultipart,
  moveTask,
  reorderTask,
} from './api';
import { epicApi } from '../features/epics/editor/epicApi';
import { groupTasks } from '../features/tasks/model/board';
import type { ActionDialogData } from '../features/tasks/model/actionData';
import type { Assignee, ColumnName } from '../shared/api/contracts';
import { isProjectId } from './model/projectSession';

export function useAppActions(model: AppControllerModel) {
  const { t } = useTranslation();
  const {
    activeId,
    archiveLifecycle,
    archivedSelected,
    dispatch,
    operations,
    refreshProject,
    session,
    setRequested,
    setRestoreFailure,
    tasks,
    viewMode,
  } = model;

  const workspace: AppWorkspaceActions = {
    onSelectProject: (projectId) => {
      void setRequested(projectId, { history: 'push' });
    },
    onBack: () => dispatch({ type: 'SET_VIEW_MODE', mode: 'board' }),
    onAdd: () => model.openDialog({ kind: 'request' }),
    onArchive: () => dispatch({ type: 'SET_VIEW_MODE', mode: 'archive' }),
    onDocs: () => {
      if (isProjectId(activeId)) model.setDocsProjectId(activeId);
    },
    onEpics: () => dispatch({ type: 'SET_VIEW_MODE', mode: 'epics' }),
    onSelectEpic: (id) => dispatch({ type: 'SELECT_EPIC', id }),
    onSelectArchiveCard: (id) => dispatch({ type: 'SELECT_ARCHIVE_CARD', id }),
    onSelectCard: (id) => dispatch({ type: 'SELECT_CARD', id }),
    onAnswerChanged: () => {
      if (isProjectId(activeId)) refreshProject(activeId);
    },
    onOpenEpic: (epicId) => {
      const epic = model.boardData?.epics.find((item) => item.id === epicId);
      if (!epic || !isProjectId(activeId)) return;
      void model.loadEpic(activeId, epic).then((loaded) => {
        if (loaded) model.openDialog({ kind: 'epic', epic: loaded });
      });
    },
    onMove: (task, column) =>
      model.openDialog({ kind: 'move', task, target: column as ColumnName }),
    onReorder: (task, beforeId) => {
      if (!isProjectId(activeId)) return;
      const projectId = activeId;
      void reorderTask(projectId, task.id, beforeId)
        .catch(() => {})
        .finally(() => refreshProject(projectId));
    },
    onArchiveDone: () => {
      if (!isProjectId(activeId) || session.operation !== null) return;
      operations.begin('archive-done', activeId);
      dispatch({ type: 'OPEN_BULK_ARCHIVE', projectId: activeId, targets: groupTasks(tasks).done });
    },
    onCloseEpic: () => dispatch({ type: 'SELECT_EPIC', id: null }),
    onEditEpic: () => {
      const epic = model.selectedEpic;
      if (!epic || !isProjectId(activeId)) return;
      void model.loadEpic(activeId, epic).then((loaded) => {
        if (loaded) model.openDialog({ kind: 'epic', epic: loaded });
      });
    },
    onDeleteEpic: async () => {
      const epic = model.selectedEpic;
      if (!epic || !activeId) return;
      await epicApi(activeId, epic.id, () => refreshProject(activeId)).remove();
    },
    onRetryEpics: () => {
      if (model.archiveVisible) model.archive.reload();
      else if (activeId) refreshProject(activeId);
    },
    onEditTask: () => {
      const card = model.selected;
      if (!card?.isDraft || !isProjectId(activeId)) return;
      void model.loadTask(activeId, card).then((task) => {
        if (task) model.openDialog({ kind: 'edit', task });
      });
    },
    onTaskChanged: () => {
      if (activeId) refreshProject(activeId);
    },
    onRemove: async (action, task) => {
      if (!isProjectId(activeId)) return false;
      const projectId = activeId;
      const result = await archiveLifecycle.run(
        action,
        projectId,
        { taskId: task.id },
        { keepOperationOnError: true },
      );
      if (!result.ok) return false;
      refreshProject(projectId);
      if (session.viewMode === 'archive') model.archive.reload();
      return true;
    },
    onRestore: () => {
      if (!isProjectId(activeId) || archivedSelected === null) return;
      const projectId = activeId;
      const taskId = archivedSelected.id;
      setRestoreFailure(null);
      void archiveLifecycle.run('restore', projectId, { taskId }).then((result) => {
        if (!result.ok) {
          setRestoreFailure({ projectId, taskId });
          return;
        }
        dispatch({ type: 'SELECT_ARCHIVE_CARD', id: null });
        model.archive.reload();
        refreshProject(projectId);
      });
    },
    onCloseDetails: () =>
      dispatch({
        type: viewMode === 'archive' ? 'SELECT_ARCHIVE_CARD' : 'SELECT_CARD',
        id: null,
      }),
  };

  const submitDialog = useCallback(
    async (data: ActionDialogData) => {
      const dialog = session.dialog;
      const operation = session.operation;
      if (!dialog || !operation) return;
      const projectId = operation.projectId;
      if (dialog.kind === 'request' && data.requestKind === 'simple') {
        await createSimpleTaskMultipart(projectId, {
          description: data.description ?? '',
          epicId: data.epicId ?? null,
          attachments: data.attachments ?? [],
        });
      } else if (dialog.kind === 'create' || dialog.kind === 'request') {
        await createNewTask(projectId, {
          title: data.title ?? '',
          description: data.description ?? '',
          assignee: data.assignee as Assignee,
          isDraft: data.isDraft,
          requestId: data.requestId,
          attachments: data.attachments,
        });
      } else if (dialog.kind === 'move') {
        await moveTask(projectId, dialog.task.id, dialog.target, data.reason ?? '');
        if (dialog.target === 'done') model.answerSession.clearTask(projectId, dialog.task.id);
      } else if (dialog.kind === 'edit') {
        if (data.attachments || data.removedAttachmentIds?.length)
          await editTaskMultipart(projectId, dialog.task.id, {
            title: data.title,
            description: data.description,
            finalize: data.finalize,
            requestId: data.requestId,
            attachments: data.attachments ?? [],
            removedAttachmentIds: data.removedAttachmentIds,
          });
        else
          await editTask(projectId, dialog.task.id, {
            title: data.title,
            description: data.description,
            body: data.body,
            acceptance: data.acceptance,
            finalize: data.finalize,
          });
      }
      refreshProject(projectId);
    },
    [model.answerSession, refreshProject, session.dialog, session.operation],
  );

  const confirmBulkArchive = useCallback(async () => {
    const bulkArchive = session.bulkArchive;
    if (!bulkArchive) return;
    const result = await archiveLifecycle.run(
      'archive-done',
      bulkArchive.projectId,
      { taskIds: bulkArchive.targets.map((task) => task.id) },
      { keepOperationOnError: true },
    );
    if (!result.ok) {
      throw new Error(
        result.error instanceof WriteError && result.error.status === 409
          ? t('archive.bulkConflict')
          : t('archive.error'),
      );
    }
    dispatch({ type: 'CLOSE_BULK_ARCHIVE' });
    refreshProject(bulkArchive.projectId);
  }, [archiveLifecycle, dispatch, refreshProject, session.bulkArchive, t]);

  const cancelBulkArchive = useCallback(() => {
    if (session.operation?.kind === 'archive-done') operations.end(session.operation.id);
    dispatch({ type: 'CLOSE_BULK_ARCHIVE' });
  }, [dispatch, operations, session.operation]);

  const closeOperation = useCallback(() => {
    if (session.operation) operations.end(session.operation.id);
  }, [operations, session.operation]);

  const savingChanged = useCallback(
    (saving: boolean) => {
      const id = session.operation?.id;
      if (id === undefined) return;
      if (saving) operations.saveStarted(id);
      else operations.saveFailed(id);
    },
    [operations, session.operation],
  );

  const openTaskFromEpic = useCallback(
    (taskId: number) => {
      const id = session.operation?.id;
      if (id !== undefined) operations.end(id);
      dispatch({ type: 'SET_VIEW_MODE', mode: 'board' });
      dispatch({ type: 'SELECT_CARD', id: taskId });
    },
    [dispatch, operations, session.operation],
  );

  const operationProjectId = session.operation?.projectId;
  const epicApiForOperation =
    session.dialog?.kind === 'epic' && operationProjectId
      ? epicApi(operationProjectId, session.dialog.epic.id, () =>
          refreshProject(operationProjectId),
        )
      : undefined;

  return {
    workspace,
    submitDialog,
    confirmBulkArchive,
    cancelBulkArchive,
    closeOperation,
    savingChanged,
    openTaskFromEpic,
    epicApiForOperation,
  };
}
