import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../src/shared/i18n';
import { groupTasks } from '../src/features/tasks/model/board';
import type { Task } from '../src/shared/api/contracts';
import { FakeEventSource, deferred, jsonResponse, stubBackend, type FakeBackend } from './fakes';
import {
  PROJECTS,
  PROJECT_A,
  PROJECT_B,
  PROJECT_C,
  boardOf,
  fixtureBoard,
  makeTask,
} from './fixtures';
import { renderApp } from './renderApp';

const missing = 'e'.repeat(32);
const tasksOfB: Task[] = [
  makeTask({ id: 8, title: 'Eight in knowledge', taskStatus: 'doing' }),
  makeTask({ id: 12, title: 'Twelve in knowledge', taskStatus: 'todo' }),
];

let backend: FakeBackend;
let fetchMock: ReturnType<typeof stubBackend>;

function restart() {
  backend = {
    projects: PROJECTS,
    boards: {
      [PROJECT_A.id]: structuredClone(fixtureBoard),
      [PROJECT_B.id]: boardOf(PROJECT_B, tasksOfB, 3),
      [PROJECT_C.id]: boardOf(PROJECT_C, [], 1),
    },
  };
  fetchMock = stubBackend(backend);
}

beforeEach(() => {
  window.localStorage.clear();
  selectLocale('en');
  FakeEventSource.reset(true);
  vi.stubGlobal('EventSource', FakeEventSource);
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
  restart();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  document.title = '';
  window.localStorage.clear();
});

const urlOf = (id: string) => `?project=${id}`;
const switcher = (name: string) => screen.getByRole('button', { name });
const taskButton = (title: string) => screen.getByRole('button', { name: new RegExp(title) });
const writes = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'DELETE');

async function choose(from: string, to: string) {
  await userEvent.click(switcher(from));
  await userEvent.click(screen.getByRole('menuitemradio', { name: to }));
}

describe('which project is shown', () => {
  it('shows the first project and writes it to the URL with replace when the URL names none', async () => {
    const app = renderApp('?foo=bar');
    await screen.findByRole('region', { name: 'Todo' });
    expect(switcher('agent-board')).toBeTruthy();
    const update = app.updates().find((event) => event.searchParams.get('project'));
    expect(update?.searchParams.get('project')).toBe(PROJECT_A.id);
    expect(update?.searchParams.get('foo')).toBe('bar');
    expect(update?.options.history).toBe('replace');
    expect(app.updates()).toHaveLength(1);
  });

  it('does not touch the URL when it already names a project', async () => {
    const app = renderApp(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    expect(switcher('knowledge')).toBeTruthy();
    expect(app.updates()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/projects/${PROJECT_A.id}/summary`,
      expect.anything(),
    );
  });

  it('puts the project name in the page title', async () => {
    renderApp(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    expect(document.title).toBe('knowledge - Agent Board');
  });

  it('switches from the menu with a pushed history entry and loads the new board', async () => {
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });

    await choose('agent-board', 'knowledge');

    await screen.findByText('Eight in knowledge');
    const update = app.updates().at(-1);
    expect(update?.searchParams.get('project')).toBe(PROJECT_B.id);
    expect(update?.options.history).toBe('push');
    expect(screen.queryByText('Initialize the board')).toBeNull();
    expect(screen.getByText('2 tasks')).toBeTruthy();
  });

  it('marks the shown project with the check in the menu', async () => {
    renderApp(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    await userEvent.click(switcher('knowledge'));
    expect(
      screen.getByRole('menuitemradio', { name: 'knowledge' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: 'agent-board' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('clears the selected task and does not carry a task number into the other project', async () => {
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Initialize the board'));
    expect(screen.getByRole('heading', { level: 2, name: 'Initialize the board' })).toBeTruthy();

    await choose('agent-board', 'knowledge');

    await screen.findByText('Eight in knowledge');
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    const details = screen.getByRole('complementary', { name: 'Task details' });
    expect(within(details).queryByRole('heading')).toBeNull();
    expect(taskButton('Eight in knowledge').getAttribute('aria-current')).toBe('false');

    await userEvent.click(taskButton('Eight in knowledge'));
    expect(screen.getByRole('heading', { level: 2, name: 'Eight in knowledge' })).toBeTruthy();
  });

  it('follows back and forward: the URL change applies the same switching rules', async () => {
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Initialize the board'));

    app.navigate(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();

    app.navigate(urlOf(PROJECT_A.id));
    await screen.findByText('Initialize the board');
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    expect(app.updates()).toHaveLength(0);
  });

  it('keeps showing the same project, by ID, when it is renamed', async () => {
    renderApp(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    await userEvent.click(taskButton('Eight in knowledge'));

    // The project list is not what the open drawer shows, so it follows the stream at once.
    backend.projects = [PROJECT_A, { ...PROJECT_B, name: 'renamed' }, PROJECT_C];
    act(() => FakeEventSource.latest.changed(PROJECT_B.id));

    await screen.findByRole('button', { name: 'renamed' });
    expect(screen.getByRole('heading', { level: 2, name: 'Eight in knowledge' })).toBeTruthy();
    expect(document.title).toBe('renamed - Agent Board');
  });

  it('keeps the archive list and shared detail column in the app shell', async () => {
    backend.archives = {
      [PROJECT_A.id]: [
        makeTask({ id: 99, title: 'Archived task', archivedAt: '2026-10-08T12:00:00Z' }),
      ],
      [PROJECT_B.id]: [],
      [PROJECT_C.id]: [],
    };
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Archive' })).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText('1 archived task')).toBeTruthy();
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize task details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to board' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Archived task/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Archived task' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize task details' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Back to board' }));
    await screen.findByRole('region', { name: 'Todo' });
  });

  it('restores the selected task through the lifecycle and returns it to its original lane idle', async () => {
    const archived = makeTask({
      id: 710,
      title: 'Restore a pending task',
      taskStatus: 'doing',
      agentStatus: 'pending',
      pendingReason: 'Waiting for approval',
      pendingRequestId: 'request-710',
      description: 'Preserved description',
      archivedAt: '2026-10-09T01:00:00Z',
    });
    const archives = { [PROJECT_A.id]: [archived], [PROJECT_B.id]: [], [PROJECT_C.id]: [] };
    backend.archives = archives;
    backend.write = (url) => {
      if (url !== `/api/projects/${PROJECT_A.id}/tasks/${archived.id}/restore`)
        return jsonResponse({}, 404);
      const restored = {
        ...archived,
        archivedAt: null,
        agentStatus: 'idle' as const,
        pendingReason: null,
        pendingRequestId: null,
      };
      archives[PROJECT_A.id] = [];
      backend.boards[PROJECT_A.id] = boardOf(PROJECT_A, [...fixtureBoard.tasks, restored], 12);
      return jsonResponse({ task: restored });
    };

    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await userEvent.click(await screen.findByRole('button', { name: /Restore a pending task/ }));
    const detail = screen.getByRole('complementary');
    expect(within(detail).getByRole('button', { name: 'Restore' })).toBeTruthy();
    expect(within(detail).getByRole('button', { name: 'Delete task' })).toBeTruthy();
    const detailChildren = Array.from(detail.children).map((el) => el.className.split(' ')[0]);
    expect(detailChildren.slice(0, 4)).toEqual([
      'detail__top',
      'detail__title',
      'detail__meta',
      'detail__tabs',
    ]);

    await userEvent.click(within(detail).getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Restore a pending task/ })).toBeNull(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back to board' }));
    const restoredButton = await screen.findByRole('button', { name: /Restore a pending task/ });
    const doing = screen.getByRole('region', { name: 'Doing' });
    expect(within(doing).getByRole('button', { name: /Restore a pending task/ })).toBe(
      restoredButton,
    );
    await userEvent.click(restoredButton);
    expect(screen.queryByText('Waiting for approval')).toBeNull();
    expect(within(screen.getByRole('complementary')).getByText('Idle')).toBeTruthy();
    expect(writes()[0]?.[0]).toBe(`/api/projects/${PROJECT_A.id}/tasks/${archived.id}/restore`);
  });

  it('keeps the archived detail after restore failure and allows a retry', async () => {
    const archived = makeTask({
      id: 711,
      title: 'Retry restore',
      description: 'Keep this content visible',
      archivedAt: '2026-10-09T01:00:00Z',
    });
    const archives = { [PROJECT_A.id]: [archived], [PROJECT_B.id]: [], [PROJECT_C.id]: [] };
    backend.archives = archives;
    let fail = true;
    backend.write = (url) => {
      if (url !== `/api/projects/${PROJECT_A.id}/tasks/${archived.id}/restore`)
        return jsonResponse({}, 404);
      if (fail) return jsonResponse({ error: { reason: 'conflict' } }, 409);
      archives[PROJECT_A.id] = [];
      return jsonResponse({ task: { ...archived, archivedAt: null, agentStatus: 'idle' } });
    };

    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await userEvent.click(await screen.findByRole('button', { name: /Retry restore/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not restore the task. Try again.',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Retry restore' })).toBeTruthy();
    expect(screen.getByText('Keep this content visible')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry restore/ })).toBeTruthy();

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: /Retry restore/ })).toBeNull());
    expect(writes().filter(([url]) => String(url).endsWith('/restore'))).toHaveLength(2);
  });

  it('physically removes an archived task on DELETE 404 and keeps confirmation after a failed delete', async () => {
    const archived = makeTask({
      id: 712,
      title: 'Permanently remove this task',
      archivedAt: '2026-10-09T01:00:00Z',
    });
    const archives = { [PROJECT_A.id]: [archived], [PROJECT_B.id]: [], [PROJECT_C.id]: [] };
    backend.archives = archives;
    let failure = true;
    backend.write = (url, init) => {
      if (url !== `/api/projects/${PROJECT_A.id}/tasks/${archived.id}` || init.method !== 'DELETE')
        return jsonResponse({}, 404);
      if (failure) return jsonResponse({ error: { reason: 'failed' } }, 500);
      archives[PROJECT_A.id] = [];
      return new Response(null, { status: 404 });
    };

    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await userEvent.click(
      await screen.findByRole('button', { name: /Permanently remove this task/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    expect(screen.getByText(/description, images, and history/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not delete the task. Try again.',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Permanently remove this task' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    failure = false;
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Permanently remove this task/ })).toBeNull(),
    );
    expect(writes().filter(([, init]) => init?.method === 'DELETE')).toHaveLength(2);
  });

  it('returns to the board when the project changes from the archive view', async () => {
    backend.archives = { [PROJECT_A.id]: [], [PROJECT_B.id]: [], [PROJECT_C.id]: [] };
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByRole('heading', { level: 2, name: 'Archive' });

    await choose('agent-board', 'knowledge');

    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.queryByRole('heading', { level: 2, name: 'Archive' })).toBeNull();
    expect(screen.getByText('2 tasks')).toBeTruthy();
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
  });

  it('keeps the selected archive detail visible when only the ordinary board refresh fails', async () => {
    backend.archives = {
      [PROJECT_A.id]: [makeTask({ id: 96, title: 'Archived during board failure' })],
    };
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await userEvent.click(
      await screen.findByRole('button', { name: /Archived during board failure/ }),
    );
    backend.boards[PROJECT_A.id] = new Error('board temporarily unavailable');
    const summaryRequests = () =>
      fetchMock.mock.calls.filter(([url]) => url === `/api/projects/${PROJECT_A.id}/summary`)
        .length;
    const previousBoardRequests = summaryRequests();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(summaryRequests()).toBeGreaterThan(previousBoardRequests);
    });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Archived during board failure' }),
    ).toBeTruthy();
  });

  it('discards a delayed archive response after switching to another project', async () => {
    const gate = deferred();
    backend.archives = {
      [PROJECT_A.id]: [makeTask({ id: 98, title: 'Stale archived task' })],
      [PROJECT_B.id]: [],
      [PROJECT_C.id]: [],
    };
    backend.gate = (url) =>
      url === `/api/projects/${PROJECT_A.id}/archive` ? gate.promise : undefined;
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Loading…')).toBeTruthy();

    app.navigate(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    gate.resolve();
    await act(async () => {});

    expect(screen.queryByText('Stale archived task')).toBeNull();
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    expect(screen.getByText('2 tasks')).toBeTruthy();
  });

  it('refreshes the archive count and list when the board event stream changes', async () => {
    const initialArchive = [makeTask({ id: 97, title: 'First archived task' })];
    backend.archives = {
      [PROJECT_A.id]: initialArchive,
      [PROJECT_B.id]: [],
      [PROJECT_C.id]: [],
    };
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByRole('button', { name: /First archived task/ });
    expect(within(screen.getByRole('main')).getByText('1 archived task')).toBeTruthy();

    backend.archives[PROJECT_A.id] = [
      ...initialArchive,
      makeTask({ id: 96, title: 'Second archived task' }),
    ];
    act(() => FakeEventSource.latest.changed(PROJECT_A.id));

    await screen.findByRole('button', { name: /Second archived task/ });
    expect(within(screen.getByRole('main')).getByText('2 archived tasks')).toBeTruthy();
  });

  it('shows the project not-found state when the active project is deleted from archive mode', async () => {
    backend.archives = {
      [PROJECT_A.id]: [makeTask({ id: 95, title: 'Archived from deleted project' })],
      [PROJECT_B.id]: [],
      [PROJECT_C.id]: [],
    };
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByRole('button', { name: /Archived from deleted project/ });

    backend.projects = [PROJECT_B, PROJECT_C];
    backend.boards[PROJECT_A.id] = 'not_found';
    act(() => FakeEventSource.latest.changed(PROJECT_A.id));

    expect(await screen.findByText('Project not found')).toBeTruthy();
    expect(document.querySelector('.list-pane')).toBeNull();
    expect(screen.queryByText('Archived from deleted project')).toBeNull();
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    expect(switcher('Choose a project')).toBeTruthy();

    await choose('Choose a project', 'knowledge');
    expect(await screen.findByText('Eight in knowledge')).toBeTruthy();
  });

  it('retries an initial archive fetch failure and shows the archived tasks after recovery', async () => {
    backend.archives = {
      [PROJECT_A.id]: new Error('archive temporarily unavailable'),
      [PROJECT_B.id]: [],
      [PROJECT_C.id]: [],
    };
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(await screen.findByText('Could not load the archive.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    backend.archives[PROJECT_A.id] = [makeTask({ id: 94, title: 'Recovered archived task' })];
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: /Recovered archived task/ })).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText('1 archived task')).toBeTruthy();
  });
});

describe('states', () => {
  it('shows Loading board… with the switcher and an empty detail area while the board loads', async () => {
    const gate = deferred();
    backend.gate = (url) => (url.endsWith('/summary') ? gate.promise : undefined);
    renderApp(urlOf(PROJECT_B.id));

    expect(await screen.findByText('Loading board…')).toBeTruthy();
    expect(switcher('knowledge')).toBeTruthy();
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(screen.getByText('Loading')).toBeTruthy();

    gate.resolve();
    await screen.findByText('Eight in knowledge');
  });

  it('shows the board error with Retry and still lets the user switch to another project', async () => {
    backend.boards[PROJECT_B.id] = 500;
    renderApp(urlOf(PROJECT_B.id));
    expect(await screen.findByText('Could not load this board.')).toBeTruthy();
    expect(screen.getByText('Not synced')).toBeTruthy();
    expect(screen.getByText('Try again, or switch to another project.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();

    await choose('knowledge', 'agent-board');
    await screen.findByRole('region', { name: 'Todo' });
    await choose('agent-board', 'knowledge');
    expect(await screen.findByText('Could not load this board.')).toBeTruthy();

    backend.boards[PROJECT_B.id] = boardOf(PROJECT_B, tasksOfB, 4);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Eight in knowledge');
  });

  it('shows the project list error with Retry and no switcher, and recovers', async () => {
    backend.projects = 500;
    renderApp(urlOf(PROJECT_A.id));
    expect(await screen.findByText('Could not load the board.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'agent-board' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();

    backend.projects = PROJECTS;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('region', { name: 'Todo' });
  });

  it('shows the no-projects state with the CLI hint, a disabled entry and the detail area', async () => {
    backend.projects = [];
    const app = renderApp(urlOf(PROJECT_A.id));
    expect(await screen.findByText('No projects yet')).toBeTruthy();
    expect(screen.getByText('Create a project using the CLI.')).toBeTruthy();
    expect(screen.getByText('agboard project create NAME')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'No projects' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(app.updates()).toHaveLength(0);
  });

  it('shows Project not found for an invalid ID, never redirects, and recovers from the menu', async () => {
    const app = renderApp('?project=not-an-id');
    expect(await screen.findByText('Project not found')).toBeTruthy();
    expect(screen.getByText(/Choose another project from the menu/)).toBeTruthy();
    expect(switcher('Choose a project')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(app.updates()).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/summary'))).toBe(false);

    await choose('Choose a project', 'tech-blog');
    await screen.findByText('No tasks yet.');
    expect(app.updates().at(-1)?.searchParams.get('project')).toBe(PROJECT_C.id);
  });

  it('shows Project not found for an ID that is not in the list and does not ask its board', async () => {
    renderApp(urlOf(missing));
    expect(await screen.findByText('Project not found')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/projects/${missing}/summary`,
      expect.anything(),
    );
  });

  it('turns into Project not found when the shown project is deleted, and lists the rest', async () => {
    renderApp(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    await userEvent.click(taskButton('Eight in knowledge'));

    backend.projects = [PROJECT_A, PROJECT_C];
    backend.boards[PROJECT_B.id] = 'not_found';
    // The open drawer holds the stream's updates back, so the person reads the board now.
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('Project not found')).toBeTruthy();
    expect(screen.queryByText('Eight in knowledge')).toBeNull();
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    await userEvent.click(switcher('Choose a project'));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'agent-board',
      'tech-blog',
    ]);
  });

  it('shows the no-projects state after the last project is deleted', async () => {
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    backend.projects = [];
    backend.boards[PROJECT_A.id] = 'not_found';
    act(() => FakeEventSource.latest.changed(PROJECT_A.id));
    expect(await screen.findByText('No projects yet')).toBeTruthy();
  });

  it('shows the empty board of a project with no tasks', async () => {
    renderApp(urlOf(PROJECT_C.id));
    expect(await screen.findByText('No tasks yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add task' })).toBeTruthy();
  });

  it('uses the Japanese state texts', async () => {
    selectLocale('ja');
    backend.projects = [];
    renderApp(urlOf(PROJECT_A.id));
    expect(await screen.findByText('プロジェクトがありません')).toBeTruthy();
    expect(screen.getByText('CLIでプロジェクトを作成してください。')).toBeTruthy();
    expect(screen.getByText('プロジェクトなし', { selector: '.status-bar__text' })).toBeTruthy();
  });
});

describe('late answers', () => {
  it('does not show the board of a project that is no longer the one shown', async () => {
    const lateA = deferred();
    backend.gate = (url) =>
      url.includes(PROJECT_A.id) && url.endsWith('/summary') ? lateA.promise : undefined;
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByText('Loading board…');

    await choose('agent-board', 'knowledge');
    await screen.findByText('Eight in knowledge');

    await act(async () => {
      lateA.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Eight in knowledge')).toBeTruthy();
    expect(screen.queryByText('Initialize the board')).toBeNull();
    expect(switcher('knowledge')).toBeTruthy();
  });
});

describe('refreshing on events', () => {
  it('fetches the list and only the shown board again on changed, and again on a reconnect', async () => {
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    const count = (suffix: string) =>
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;
    const lists = count('/api/projects');
    const boardsOfA = count(`${PROJECT_A.id}/summary`);

    act(() => FakeEventSource.latest.changed(PROJECT_A.id));
    await waitFor(() => expect(count('/api/projects')).toBe(lists + 1));
    await waitFor(() => expect(count(`${PROJECT_A.id}/summary`)).toBe(boardsOfA + 1));
    expect(count(`${PROJECT_B.id}/summary`)).toBe(0);

    act(() => FakeEventSource.latest.emit('error'));
    expect(screen.getByText(/^Disconnected · Last synced/)).toBeTruthy();
    // The connection reopens by itself after a pause; the lists and the Summary are read again.
    await waitFor(() => expect(count('/api/projects')).toBe(lists + 2), { timeout: 4000 });
    await waitFor(() => expect(screen.getByText(/^Synced/)).toBeTruthy());
    await waitFor(() => expect(count(`${PROJECT_A.id}/summary`)).toBe(boardsOfA + 2));
  });
});

async function openCreateForm() {
  await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
  await userEvent.click(screen.getByRole('button', { name: 'Create manually' }));
  return screen.getByRole('dialog');
}

describe('switching while a form is open', () => {
  it('disables the switcher and Add task while the add form is open', async () => {
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await openCreateForm();
    // The open dialog hides the page from the accessibility tree, so look at the DOM.
    const button = document.querySelector<HTMLButtonElement>('.project-switcher');
    expect(button?.disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(button?.disabled).toBe(false));
  });

  it('holds the latest URL request, keeps the board and the input, and applies it after cancel without a new history entry', async () => {
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    const dialog = await openCreateForm();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Half written');

    app.navigate(urlOf(PROJECT_C.id));
    app.navigate(urlOf(PROJECT_B.id));
    await act(async () => {});

    expect(within(screen.getByRole('dialog')).getByLabelText('Title')).toHaveProperty(
      'value',
      'Half written',
    );
    expect(document.body.textContent).toContain('Initialize the board');
    expect(document.body.textContent).not.toContain('Eight in knowledge');

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    // The typed title is unsaved, so the question comes first; discarding it applies the URL.
    const question = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await userEvent.click(within(question).getByRole('button', { name: 'Discard and close' }));
    await screen.findByText('Eight in knowledge');
    expect(switcher('knowledge')).toBeTruthy();
    expect(app.updates()).toHaveLength(0);
  });

  it('writes to the project the form was opened in, then shows the project the URL moved to', async () => {
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    const dialog = await openCreateForm();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'New task');

    app.navigate(urlOf(PROJECT_B.id));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));

    await screen.findByText('Eight in knowledge');
    const posts = writes();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe(`/api/projects/${PROJECT_A.id}/tasks`);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
      title: 'New task',
      description: '---\nacceptance: []\n---\n\n',
      assignee: 'ai',
      isDraft: false,
    });
    expect(app.updates()).toHaveLength(0);
  });

  it('keeps the input, the project and the held request when saving fails', async () => {
    backend.write = () =>
      jsonResponse(
        { error: { code: 'database_busy', message: 'x', reason: 'The board is busy.' } },
        503,
      );
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    const dialog = await openCreateForm();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Keep me');
    app.navigate(urlOf(PROJECT_B.id));

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));

    // The server's reason is not shown; the design's sentence is.
    expect(await screen.findByText('Could not save. Your input is kept. Try again.')).toBeTruthy();
    expect(screen.queryByText('The board is busy.')).toBeNull();
    const open = screen.getByRole('dialog');
    expect(within(open).getByLabelText('Title')).toHaveProperty('value', 'Keep me');
    expect(document.body.textContent).toContain('Initialize the board');

    backend.write = undefined;
    await userEvent.click(within(open).getByRole('button', { name: 'Add' }));
    await screen.findByText('Eight in knowledge');
  });

  it('sends an answer to the project where the answer form was opened, with that task number', async () => {
    const pendingA = fixtureBoard.tasks.find((task) => task.agentStatus === 'pending');
    expect(pendingA).toBeTruthy();
    backend.boards[PROJECT_B.id] = boardOf(
      PROJECT_B,
      [makeTask({ id: pendingA?.id ?? 12, title: 'Same number elsewhere' })],
      2,
    );
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton(pendingA?.title ?? ''));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Go ahead');
    expect(
      (screen.getByRole('button', { name: 'agent-board' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    app.navigate(urlOf(PROJECT_B.id));
    await act(async () => {});
    expect(
      (screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value,
    ).toBe('Go ahead');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Same number elsewhere');
    const posts = writes();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe(`/api/projects/${PROJECT_A.id}/tasks/${pendingA?.id}/answer`);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({
      requestId: pendingA?.pendingRequestId,
      text: 'Go ahead',
    });
  });

  it('keeps the project and the confirmation open while an archive confirmation is open, and archives in that project', async () => {
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Prepare the Windows build'));
    await userEvent.click(screen.getByRole('button', { name: 'Archive task' }));
    expect(
      (screen.getByRole('button', { name: 'agent-board' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Add task' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    app.navigate(urlOf(PROJECT_B.id));
    await act(async () => {});
    expect(screen.getByText(/Archive #14/)).toBeTruthy();
    expect(screen.queryByText('Eight in knowledge')).toBeNull();

    await userEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: 'Archive' }),
    );

    await screen.findByText('Eight in knowledge');
    const calls = writes();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(`/api/projects/${PROJECT_A.id}/tasks/14/archive`);
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
  });

  it('shows the project name and exact reversible-data note in the bulk archive dialog', async () => {
    selectLocale('ja');
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('button', { name: '完了タスクをアーカイブ' });

    await userEvent.click(screen.getByRole('button', { name: '完了タスクをアーカイブ' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('agent-board の完了タスク2件をアーカイブします。'),
    ).toBeTruthy();
    expect(
      within(dialog).getByText('本文・画像・履歴は保持され、アーカイブ一覧から復元できます。'),
    ).toBeTruthy();
    expect(within(dialog).getAllByRole('row')).toHaveLength(3);
    expect(within(dialog).getAllByText('AI')).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: /閉じる|Close/ })).toBeNull();
  });

  it('keeps the exact target snapshot after a 409 and sends fresh targets only after reopening', async () => {
    const initialDoneIds = groupTasks(fixtureBoard.tasks).done.map((task) => task.id);
    const submittedIds: number[][] = [];
    let conflict = true;
    backend.write = (url, init) => {
      if (url !== `/api/projects/${PROJECT_A.id}/tasks/archive-done`) return jsonResponse({}, 404);
      submittedIds.push(JSON.parse(String(init.body)).ids as number[]);
      if (conflict) {
        conflict = false;
        return jsonResponse(
          { error: { code: 'request_changed', message: 'conflict', reason: 'changed' } },
          409,
        );
      }
      return jsonResponse({ tasks: [], archivedCount: submittedIds.at(-1)?.length ?? 0 });
    };

    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive completed tasks' }));
    let dialog = screen.getByRole('dialog');
    const targetRows = within(dialog).getAllByRole('row').slice(1);
    expect(targetRows.map((row) => row.firstElementChild?.textContent)).toEqual(
      initialDoneIds.map((id) => `#${id}`),
    );

    backend.boards[PROJECT_A.id] = boardOf(
      PROJECT_A,
      [
        ...fixtureBoard.tasks.filter((task) => task.id !== initialDoneIds[1]),
        makeTask({ id: 17, title: 'Added after opening', taskStatus: 'done' }),
      ],
      2,
    );
    const boardUrl = `/api/projects/${PROJECT_A.id}/summary`;
    const readsBeforeChange = fetchMock.mock.calls.filter(([url]) => url === boardUrl).length;
    // The open dialog holds the stream's updates back; the refresh button reads the board now.
    // The dialog hides the page from the accessibility tree, so press it through the DOM.
    act(() => document.querySelector<HTMLButtonElement>('.header__refresh')?.click());
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === boardUrl).length).toBeGreaterThan(
        readsBeforeChange,
      ),
    );
    expect(
      within(dialog)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.firstElementChild?.textContent),
    ).toEqual(initialDoneIds.map((id) => `#${id}`));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive 2 tasks' }));
    expect(
      await within(dialog).findByText(/Tasks changed while this confirmation was open/),
    ).toBeTruthy();
    expect(
      within(dialog)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.firstElementChild?.textContent),
    ).toEqual(initialDoneIds.map((id) => `#${id}`));
    expect(submittedIds).toEqual([initialDoneIds]);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive completed tasks' }));
    dialog = screen.getByRole('dialog');
    const reopenedIds = within(dialog)
      .getAllByRole('row')
      .slice(1)
      .map((row) => Number(row.firstElementChild?.textContent?.slice(1)));
    expect(reopenedIds).toEqual([initialDoneIds[0], 17]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive 2 tasks' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(submittedIds).toEqual([initialDoneIds, reopenedIds]);
  });

  it('keeps a pending bulk archive open and rejects duplicate submissions until the write settles', async () => {
    const response = deferred<Response>();
    const started = deferred<void>();
    backend.write = (url) => {
      if (url !== `/api/projects/${PROJECT_A.id}/tasks/archive-done`) return jsonResponse({}, 404);
      started.resolve();
      return response.promise;
    };

    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive completed tasks' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Archive 2 tasks' });

    await userEvent.dblClick(submit);
    await started.promise;
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(true));
    expect(
      writes().filter(([url]) => url === `/api/projects/${PROJECT_A.id}/tasks/archive-done`),
    ).toHaveLength(1);

    await userEvent.keyboard('{Escape}');
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(
      (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      response.resolve(jsonResponse({ tasks: [], archivedCount: 2 }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('lets the user switch again after the delete confirmation is cancelled', async () => {
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Prepare the Windows build'));
    await userEvent.click(screen.getByRole('button', { name: 'Archive task' }));
    const cancelButton = document.querySelector<HTMLButtonElement>(
      '.delete-confirm button:last-child',
    );
    if (!cancelButton) throw new Error('archive confirmation cancel button is missing');
    await userEvent.click(cancelButton);
    expect(
      (screen.getByRole('button', { name: 'agent-board' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await choose('agent-board', 'knowledge');
    await screen.findByText('Eight in knowledge');
  });

  it('leaves the language and the details width alone for the held request', async () => {
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await openCreateForm();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('radio', { name: '日本語' }));
    expect(document.documentElement.lang).toBe('ja');
    await userEvent.keyboard('{Escape}');
    expect(
      (screen.getByRole('button', { name: 'agent-board' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('Japanese state screens use the approved texts', () => {
  const hint = 'タスクを選択すると詳細が表示されます。';

  it('board loading', async () => {
    selectLocale('ja');
    const gate = deferred();
    backend.gate = (url) => (url.endsWith('/summary') ? gate.promise : undefined);
    renderApp(urlOf(PROJECT_B.id));
    expect(await screen.findByText('ボードを読み込み中…')).toBeTruthy();
    expect(screen.getByText('読み込み中', { selector: '.status-bar__text' })).toBeTruthy();
    expect(screen.getByText(hint)).toBeTruthy();
    gate.resolve();
  });

  it('board load failure', async () => {
    selectLocale('ja');
    backend.boards[PROJECT_B.id] = 500;
    renderApp(urlOf(PROJECT_B.id));
    expect(await screen.findByText('ボードを読み込めませんでした')).toBeTruthy();
    expect(
      screen.getByText('もう一度お試しください。別のプロジェクトにも切り替えられます。'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    expect(screen.getByText('未同期', { selector: '.status-bar__text' })).toBeTruthy();
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it('no projects', async () => {
    selectLocale('ja');
    backend.projects = [];
    renderApp(urlOf(PROJECT_A.id));
    expect(await screen.findByText('プロジェクトがありません')).toBeTruthy();
    expect(screen.getByText('CLIでプロジェクトを作成してください。')).toBeTruthy();
    expect(screen.getByText('プロジェクトなし', { selector: '.status-bar__text' })).toBeTruthy();
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it('project not found', async () => {
    selectLocale('ja');
    renderApp(urlOf(missing));
    expect(await screen.findByText('プロジェクトが見つかりません')).toBeTruthy();
    expect(
      screen.getByText(
        '削除されたか、URLが無効です。上のメニューから別のプロジェクトを選択してください。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('未選択', { selector: '.status-bar__text' })).toBeTruthy();
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it('the normal board keeps its own unselected text', async () => {
    selectLocale('ja');
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: '未着手' });
    expect(screen.getByText('タスクを選択すると詳細を表示します。')).toBeTruthy();
  });
});
