import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { makeEpic, makeProject, makeTask } from '../../.storybook/support/fixtures';
import { initSession } from './model/projectSession';
import type { AppControllerModel, AppView } from './contracts';
import { BoardWorkspace } from './BoardWorkspace';

const project = makeProject({ name: 'agent-board' });
const taskBody = `## 背景と方針

担当エージェントが共有領域にTASK.mdと確認キャプチャを保存する。ボードから同じ本文と画像を開けることを確認し、結果と根拠をこのタスクに残す。

## 進め方

\`\`\`mermaid
%%{init: {"theme": "base", "themeVariables": {"fontSize": "11px", "primaryColor": "#ffffff", "primaryTextColor": "#475569", "primaryBorderColor": "#dbe3ef", "lineColor": "#2563eb", "secondaryColor": "#ffffff", "tertiaryColor": "#ffffff"}, "flowchart": {"nodeSpacing": 8, "rankSpacing": 8, "diagramPadding": 4, "wrappingWidth": 240}}}%%
flowchart TD
  A[タスクを割り当てる] --> B[作業・結果を記録する]
  B --> C[条件と根拠を確認する]
  C --> D[受け入れてDONE]
  classDef flat fill:#ffffff,stroke:#dbe3ef,color:#475569,stroke-width:1px,filter:none;
  class A,B,C,D flat;
  linkStyle default stroke:#2563eb,stroke-width:1px;
\`\`\`

図1　共有記録を使った作業の受け渡し`;
const accepted = [
  '保存したTASK.mdと確認キャプチャを開ける',
  '結果と根拠を本文に記録できる',
  '共有領域の相対パスを保つ',
  '回答待ちの状態を表示できる',
  '受け入れ条件が完了している',
].map((text, index) => ({ id: `AC-${index + 1}`, text, done: index < 3 }));
const timestamp = '2026-10-02T01:08:00.000Z';
const history = Array.from({ length: 7 }, (_, index) => ({
  at: timestamp,
  reason: `作業記録 ${index + 1}`,
}));
const makeBoardTask = (
  id: number,
  title: string,
  taskStatus: 'todo' | 'doing' | 'done',
  agentStatus: 'idle' | 'running' | 'pending' = 'idle',
  pendingReason: string | null = null,
) =>
  makeTask({
    id,
    title,
    description: taskStatus === 'done' && id === 8 ? taskBody : '',
    body: taskStatus === 'done' && id === 8 ? taskBody : '',
    acceptance: id === 11 ? accepted : [],
    taskStatus,
    taskStatusChangedAt: timestamp,
    updatedAt: timestamp,
    createdAt: timestamp,
    agentStatus,
    agentStatusChangedAt: timestamp,
    pendingReason,
    history,
  });
const selectedTask = makeBoardTask(8, 'Initialize the board', 'done');
const boardTasks = [
  makeBoardTask(14, 'Prepare the Windows build', 'todo'),
  makeBoardTask(15, 'Write the setup guide', 'todo'),
  makeBoardTask(16, 'Refine the empty board', 'todo'),
  makeBoardTask(11, 'Implement card moves', 'doing'),
  makeBoardTask(12, 'Restore a board from JSON', 'doing', 'pending', '置き換え方法の確認待ち'),
  makeBoardTask(13, 'Check the board display', 'doing'),
  makeBoardTask(9, 'Return the card list as JSON', 'done'),
  selectedTask,
];
const task = selectedTask;
const taskTitle = task.title;
const epic = makeEpic({ id: 'release', name: 'Release' });
const boardData = {
  tasks: boardTasks,
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
      lastSyncedAt: new Date(2026, 9, 2, 10, 42),
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
      stateStore: undefined,
      writeAnswer: async () => {
        throw new Error('No decision request is active in this Story.');
      },
      onAnswered: () => {},
      wasAnswered: () => false,
      withSavedAnswers: (_id: string, tasks: typeof boardData.tasks) => tasks,
      reconcileTasks: () => {},
      clearTask: () => {},
      hasSavedAnswers: () => false,
    },
    tasks: boardTasks,
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
    width: 360,
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
    docsProjectId: null,
    setDocsProjectId: () => {},
  } as unknown as AppControllerModel;
}

type WorkspaceStoryState = AppView | 'disconnected';

type WorkspaceStoryOverrides = Partial<
  Pick<AppControllerModel, 'detailShown' | 'message' | 'barStatus' | 'connected' | 'streamDown'>
> & { projectName?: string };

function makeStateModel(
  view: WorkspaceStoryState,
  overrides: WorkspaceStoryOverrides = {},
): AppControllerModel {
  const base = makeModel();
  const scenarioProject = overrides.projectName
    ? makeProject({ id: project.id, name: overrides.projectName })
    : project;
  const messages: Partial<Record<AppView, AppControllerModel['message']>> = {
    'projects-loading': 'loading',
    'projects-error': 'error',
    'no-projects': 'noProjects',
    resolving: 'switching',
    'not-found': 'notFound',
    'board-loading': 'switching',
    'board-error': 'boardError',
  };
  const appView = view === 'disconnected' ? 'board' : view;
  const projects =
    view === 'projects-loading'
      ? { ...base.projects, status: 'loading' as const, projects: [] }
      : view === 'projects-error'
        ? { ...base.projects, status: 'error' as const, fetchFailed: true }
        : view === 'no-projects'
          ? { ...base.projects, projects: [] }
          : overrides.projectName
            ? { ...base.projects, projects: [scenarioProject] }
            : base.projects;
  const board =
    view === 'board-loading'
      ? { ...base.board, status: 'loading' as const, board: null }
      : view === 'board-error'
        ? {
            ...base.board,
            status: 'error' as const,
            board: null,
            error: 'failed',
            fetchFailed: true,
          }
        : view === 'not-found'
          ? { ...base.board, status: 'error' as const, board: null, error: 'not_found' }
          : view === 'disconnected'
            ? { ...base.board, lastSyncedAt: new Date(2026, 9, 2, 10, 42) }
            : base.board;
  const noActiveProject = view === 'no-projects' || view === 'resolving' || view === 'not-found';
  return {
    ...base,
    projects,
    board,
    activeId: noActiveProject ? null : base.activeId,
    activeName: overrides.projectName ?? base.activeName,
    known: !noActiveProject,
    boardData: appView === 'board' ? base.boardData : null,
    selected: view === 'board-loading' || view === 'board-error' ? null : base.selected,
    view: appView,
    detailShown:
      overrides.detailShown ?? (view !== 'projects-loading' && view !== 'projects-error'),
    barStatus:
      overrides.barStatus ??
      (view === 'projects-loading' ? 'loading' : view === 'projects-error' ? 'error' : 'ready'),
    message: overrides.message ?? (view === 'disconnected' ? null : (messages[view] ?? null)),
    connected: overrides.connected ?? view !== 'disconnected',
    streamDown: overrides.streamDown ?? view === 'disconnected',
  } as AppControllerModel;
}

const meta = {
  title: 'App/Board Workspace',
  component: BoardWorkspace,
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <div className="app">
      <BoardWorkspace {...args} />
    </div>
  ),
  args: { model: makeModel(), actions: { onArchiveDone: () => {} } as never, guide: false },
} satisfies Meta<typeof BoardWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Board: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText(taskTitle).length).toBeGreaterThan(0);
    await expect(canvas.getByText('Prepare the Windows build')).toBeInTheDocument();
    await expect(canvas.getByText('置き換え方法の確認待ち')).toBeInTheDocument();
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument();
    await expect(canvas.getByRole('contentinfo')).toBeInTheDocument();
  },
};
export const Archive: Story = { args: { model: makeModel('archive') } };
export const Epics: Story = { args: { model: makeModel('epics') } };
export const ProjectsLoading: Story = { args: { model: makeStateModel('projects-loading') } };
export const ProjectsError: Story = { args: { model: makeStateModel('projects-error') } };
export const NoProjects: Story = { args: { model: makeStateModel('no-projects') } };
export const ResolvingProject: Story = { args: { model: makeStateModel('resolving') } };
export const ProjectNotFound: Story = { args: { model: makeStateModel('not-found') } };
export const BoardLoading: Story = {
  args: { model: makeStateModel('board-loading', { projectName: 'knowledge' }) },
};
export const BoardError: Story = {
  args: { model: makeStateModel('board-error', { projectName: 'knowledge' }) },
};
export const BoardLoadingWholeScreen: Story = {
  args: {
    model: makeStateModel('board-loading', {
      detailShown: false,
      message: 'loading',
    }),
  },
};
export const BoardErrorWholeScreen: Story = {
  args: {
    model: makeStateModel('board-error', {
      detailShown: false,
      message: 'error',
      barStatus: 'error',
      connected: false,
      streamDown: true,
    }),
  },
};
export const Disconnected: Story = { args: { model: makeStateModel('disconnected') } };
