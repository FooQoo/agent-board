import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { makeEpic, makeProject, makeTask } from '../../.storybook/support/fixtures';
import { initSession } from './model/projectSession';
import type { AppControllerModel } from './contracts';
import { BoardWorkspace } from './BoardWorkspace';

const project = makeProject();
const taskTitle = 'Prepare the release';
const task = makeTask({ id: 21, title: taskTitle, taskStatus: 'doing' });
const epic = makeEpic({ id: 'release', name: 'Release' });
const boardData = {
  tasks: [task],
  epics: [epic],
  problems: [],
  epicTaskCounts: { release: { todo: 0, doing: 1, done: 0 } },
};

function makeModel(viewMode: 'board' | 'archive' | 'epics' = 'board'): AppControllerModel {
  const session = { ...initSession(project.id, task.id), viewMode, epicSelectedId: 'release' };
  return {
    session,
    dispatch: () => {},
    operations: {
      begin: () => 1,
      saveStarted: () => {},
      saveFailed: () => {},
      end: () => {},
      taskRemoved: () => {},
      isCurrent: () => true,
    },
    projects: {
      status: 'ready',
      projects: [project],
      catalogVersion: '1',
      fetchFailed: false,
      reload: () => {},
    },
    board: {
      status: 'ready',
      board: boardData,
      error: null,
      fetchFailed: false,
      lastSyncedAt: null,
      reload: () => {},
    },
    archive: {
      status: 'ready',
      data: { tasks: [task], epics: [epic] },
      error: null,
      fetchFailed: false,
      lastSyncedAt: null,
      reload: () => {},
    },
    answerSession: {
      withSavedAnswers: (_id: string, tasks: typeof boardData.tasks) => tasks,
      reconcileTasks: () => {},
      clearTask: () => {},
      hasSavedAnswers: () => false,
    },
    tasks: [task],
    selected: task,
    archivedSelected: task,
    selectedEpic: epic,
    activeId: project.id,
    activeName: project.name,
    known: true,
    boardData,
    view: 'board',
    archiveVisible: viewMode === 'archive',
    epicsVisible: viewMode === 'epics',
    detailShown: true,
    stalePage: false,
    isMockTask: false,
    mockInitial: undefined,
    barStatus: 'ready',
    message: null,
    retry: () => {},
    connected: true,
    streamDown: false,
    width: 420,
    bodyRef: { current: null },
    attachLayoutRef: () => {},
    startDrag: () => {},
    moveDrag: () => {},
    endDrag: () => {},
    archiveLifecycle: { run: async () => ({ ok: true }) },
    openDialog: () => {},
    refreshProject: () => {},
    setRequested: async () => new URLSearchParams(),
    restoreFailure: null,
    setRestoreFailure: () => {},
    projectName: () => project.name,
    viewMode,
  } as unknown as AppControllerModel;
}

const meta = {
  title: 'App/Board Workspace',
  component: BoardWorkspace,
  parameters: { layout: 'fullscreen' },
  args: { model: makeModel(), actions: {} as never },
} satisfies Meta<typeof BoardWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Board: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('Prepare the release').length).toBeGreaterThan(
      0,
    );
  },
};
export const Archive: Story = { args: { model: makeModel('archive') } };
export const Epics: Story = { args: { model: makeModel('epics') } };
