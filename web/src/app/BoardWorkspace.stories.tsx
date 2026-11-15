import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { makeEpic, makeProject, makeTask } from '../../.storybook/support/fixtures';
import { AnswerBook } from '../features/tasks/answer/model/answerBook';
import type { BandQuestion } from '../features/tasks/answer/model/qa';
import {
  SAMPLE_PROJECT,
  sampleBook,
  sampleQuestions,
} from '../features/tasks/answer/questionSamples';
import { initSession } from './model/projectSession';
import type { AppControllerModel, AppView } from './contracts';
import { detailFixtureOf, withDetailFixture } from '../features/tasks/detail/detailFixture';
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
  questions: [] as BandQuestion[],
};

/** The answer side of the model, with a book that may hold answers. */
function answersOf(book: AnswerBook): AppControllerModel['answers'] {
  return { book, target: null, open: () => {}, openForTask: () => {}, close: () => {} };
}

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
    answers: answersOf(new AnswerBook()),
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
    subscribeDocs: () => () => {},
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
  // The drawer and the epic screen read their Detail: this serves the cards' and the epic's.
  render: (args) =>
    withDetailFixture(
      detailFixtureOf(boardTasks, [epic]),
      <div className="app">
        <BoardWorkspace {...args} />
      </div>,
    ),
  args: { model: makeModel(), actions: { onArchiveDone: () => {} } as never },
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

/** The board of the approved mock: five questions wait, from five cards and one with none. */
function makeQuestionModel(held: number, empty = false): AppControllerModel {
  const base = makeModel();
  const questions = empty ? [] : sampleQuestions('ja');
  const waiting = (id: number) =>
    questions.filter((question) => question.referencedBy.includes(id)).map((q) => q.id);
  const card = (
    id: number,
    title: string,
    taskStatus: 'todo' | 'doing' | 'done',
    agentStatus: 'idle' | 'pending' = 'idle',
  ) => {
    const open = waiting(id);
    return {
      ...makeBoardTask(id, title, taskStatus, open.length > 0 ? 'pending' : agentStatus),
      openQuestionIds: open,
      questionIds: open,
    };
  };
  const tasks = [
    card(14, 'Prepare the Windows build', 'todo'),
    card(15, 'Write the setup guide', 'todo'),
    card(16, 'Refine the empty board', 'todo'),
    card(11, 'APIリファクタリング', 'doing'),
    card(12, 'Restore a board from JSON', 'doing'),
    card(13, 'Check the board display', 'doing'),
    card(9, 'Return the card list as JSON', 'done'),
    card(8, 'Initialize the board', 'done'),
  ];
  const project = makeProject({ id: SAMPLE_PROJECT, name: 'agent-board' });
  const data = { ...boardData, tasks, questions };
  return {
    ...base,
    session: { ...base.session, projectId: SAMPLE_PROJECT },
    projects: { ...base.projects, projects: [project] },
    board: { ...base.board, board: data },
    activeId: SAMPLE_PROJECT,
    boardData: data,
    tasks,
    selected: null,
    detailShown: false,
    answers: answersOf(sampleBook(questions, held)),
  } as unknown as AppControllerModel;
}

/** The band above the lanes, closed at first; its header opens the five questions. */
export const QuestionBandOpen: Story = {
  args: { model: makeQuestionModel(0) },
  globals: { locale: 'ja' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const band = within(canvas.getByRole('region', { name: '未回答の質問' }));
    await expect(band.queryAllByRole('listitem')).toHaveLength(0);
    await expect(canvas.getByText('未回答の質問 2 件')).toBeInTheDocument();
    await userEvent.click(band.getByRole('button', { name: /^未回答の質問を表示する/ }));
    await expect(band.getAllByRole('listitem')).toHaveLength(5);
  },
};

/** Two answers held: the band and the card say so. */
export const QuestionBandHeld: Story = {
  args: { model: makeQuestionModel(2) },
  globals: { locale: 'ja' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '確認して送る' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '回答を続ける' })).toBeInTheDocument();
  },
};

/** No questions: the band keeps its place above the lanes with a count of 0 and nothing to open. */
export const QuestionBandEmpty: Story = {
  args: { model: makeQuestionModel(0, true) },
  globals: { locale: 'ja' },
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: '未回答の質問' });
    await expect(within(band).getByText('0')).toBeVisible();
    await expect(within(band).getByRole('button')).toBeDisabled();
  },
};

/** The board with its band in dark mode. */
export const QuestionBandDark: Story = {
  args: { model: makeQuestionModel(2) },
  globals: { locale: 'ja', mode: 'dark' },
};
