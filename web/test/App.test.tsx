import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../src/shared/i18n';
import type { Board } from '../src/shared/api/contracts';
import { FakeEventSource, jsonResponse, stubBackend, type FakeBackend } from './fakes';
import { PROJECTS, PROJECT_A, fixtureBoard } from './fixtures';
import { renderApp } from './renderApp';

let backend: FakeBackend;
let fetchMock: ReturnType<typeof vi.fn>;
const SEARCH = `?project=${PROJECT_A.id}`;

/** The board of project A as the fake server holds it. */
function current(): Board {
  return backend.boards[PROJECT_A.id] as Board;
}
function setCurrent(board: Board) {
  backend.boards[PROJECT_A.id] = board;
}
function show(props?: Parameters<typeof renderApp>[1]) {
  return renderApp(SEARCH, props);
}

beforeEach(() => {
  window.localStorage.clear();
  selectLocale('en');
  backend = {
    projects: PROJECTS,
    boards: { [PROJECT_A.id]: structuredClone(fixtureBoard) },
    write: (url, init) => {
      const match = /^\/api\/projects\/([0-9a-f]{32})\/tasks\/(\d+)\/archive$/.exec(url);
      if (match?.[1] === PROJECT_A.id && init.method === 'POST') {
        const task = current().tasks.find((c) => c.id === Number(match[2]));
        setCurrent({
          ...current(),
          tasks: current().tasks.filter((c) => c.id !== Number(match[2])),
        });
        return jsonResponse({ task: { ...task, archivedAt: '2026-10-08T00:00:00Z' } });
      }
      return jsonResponse({}, 404);
    },
  };
  FakeEventSource.reset(true);
  vi.stubGlobal('EventSource', FakeEventSource);
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
  fetchMock = stubBackend(backend);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  document.title = '';
  selectLocale('en');
  window.localStorage.clear();
});

const lane = (name: string) => screen.getByRole('region', { name });
const taskButton = (title: string) => screen.getByRole('button', { name: new RegExp(title) });

describe('App', () => {
  it('shows Loading… first, then the board with its name in the header and the page title', async () => {
    show();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Task details' })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'agent-board' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();

    // The project name shows once the list is in; the board follows with its own request.
    await screen.findByText('agent-board');
    expect(document.title).toBe('agent-board - Agent Board');
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.getByRole('complementary', { name: 'Task details' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize task details' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Agent Board' })).toBeTruthy();
    expect(screen.getByText('agent-board')).toBeTruthy();
    expect(document.title).toBe('agent-board - Agent Board');
    expect(screen.getByText('8 tasks')).toBeTruthy();
  });

  it('lays the tasks out in three lanes with counts, newest Done first', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    const titles = (name: string) =>
      within(lane(name))
        .getAllByRole('button', { name: /Updated/ })
        .map((b) => b.querySelector('.card__id')?.textContent);
    expect(titles('Todo')).toEqual(['#14', '#15', '#16']);
    expect(titles('Doing')).toEqual(['#11', '#12', '#13']);
    expect(titles('Done')).toEqual(['#9', '#8']);
    expect(
      within(lane('Done')).getByRole('heading', { name: 'Done' }).nextElementSibling?.textContent,
    ).toBe('2');
  });

  it('shows the details of a clicked task and clears them with Close details', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();

    await userEvent.click(taskButton('Initialize the board'));
    expect(screen.getByRole('heading', { level: 2, name: 'Initialize the board' })).toBeTruthy();
    expect(taskButton('Initialize the board').getAttribute('aria-current')).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    expect(taskButton('Initialize the board').getAttribute('aria-current')).toBe('false');
  });

  it('switches the details when another task is clicked', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Initialize the board'));
    await userEvent.click(taskButton('Implement task moves'));
    expect(screen.getByRole('heading', { level: 2, name: 'Implement task moves' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Initialize the board' })).toBeNull();
  });

  it('keeps the selection when the board changes and the task still exists', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Implement task moves'));

    setCurrent({
      ...current(),
      tasks: current().tasks.map((c) =>
        c.id === 11 ? { ...c, agentStatus: 'pending' as const, pendingReason: 'Waiting' } : c,
      ),
    });
    act(() => FakeEventSource.latest.changed(PROJECT_A.id));

    await waitFor(() => expect(screen.getAllByText('Pending').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { level: 2, name: 'Implement task moves' })).toBeTruthy();
  });

  it('applies a change that arrived while the drawer was open once the drawer has closed', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Initialize the board'));

    // The open drawer holds the stream's updates back, so the board still lists the task.
    setCurrent({ ...current(), tasks: current().tasks.filter((c) => c.id !== 8) });
    act(() => FakeEventSource.latest.changed(PROJECT_A.id));
    expect(screen.getByRole('heading', { level: 2, name: 'Initialize the board' })).toBeTruthy();
    expect(screen.getByText('8 tasks')).toBeTruthy();

    // After the drawer has been closed for three seconds, the change is applied.
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.getByText('7 tasks')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
  });

  it('archives a task after confirmation, returns to no selection and fetches the board again', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Prepare the Windows build'));
    await userEvent.click(screen.getByRole('button', { name: 'Archive task' }));
    await userEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: 'Archive' }),
    );

    await waitFor(() => expect(screen.getByText('Select a task to see its details.')).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Prepare the Windows build/ })).toBeNull(),
    );
    expect(screen.getByText('7 tasks')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PROJECT_A.id}/tasks/14/archive`, {
      method: 'POST',
      headers: { 'X-Agboard-Token': 'test-token', 'X-Agboard-Language': 'en' },
    });
  });

  it('reads the board from its Summary and never from the board route', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Implement task moves'));
    await screen.findByRole('heading', { level: 2, name: 'Implement task moves' });
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain(`/api/projects/${PROJECT_A.id}/summary`);
    // Opening the drawer reads the whole task once: the text, its conditions and the log.
    expect(urls).toContain(
      `/api/projects/${PROJECT_A.id}/tasks/11/detail?sections=document,history`,
    );
    expect(urls.filter((url) => url.endsWith('/board'))).toEqual([]);
  });

  it('reads the whole task once when it opens, and reuses it when the tab changes', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    const reads = (sections: string) =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes(`/tasks/11/detail?sections=${sections}`),
      ).length;
    await userEvent.click(taskButton('Implement task moves'));
    await screen.findByRole('heading', { level: 2, name: 'Implement task moves' });
    expect(reads('document,history')).toBe(1);
    // The description is drawn: the document has arrived whole.
    await waitFor(() =>
      expect(
        document.querySelector('.detail__viewport .md, .detail__viewport .md-empty'),
      ).not.toBeNull(),
    );
    // The count is known before the History tab is opened.
    await waitFor(() => expect(screen.getByRole('tab', { name: /^History \d/ })).toBeTruthy());
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Description' }));
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    // Switching tabs reads nothing more.
    expect(reads('document,history')).toBe(1);
  });

  it('reads the epic document with the task, and reuses it for the next task of the epic', async () => {
    const epic = {
      id: 'PLAN',
      name: 'Plan',
      color: '#7C3AED',
      isDraft: false,
      document: 'The epic plan.',
      body: 'The epic plan.',
      priority: [],
      priorityError: false,
      attachments: [],
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    };
    const ref = { id: epic.id, name: epic.name, color: epic.color };
    setCurrent({
      ...current(),
      epics: [epic],
      epicTaskCounts: { PLAN: { todo: 1, doing: 1, done: 0, archived: 0, total: 2 } },
      tasks: current().tasks.map((task) =>
        task.id === 11 || task.id === 12 ? { ...task, epic: ref } : task,
      ),
    });
    show();
    await screen.findByRole('region', { name: 'Todo' });
    const epicReads = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/epics/PLAN/detail')).length;
    await userEvent.click(taskButton('Implement task moves'));
    await screen.findByRole('heading', { level: 2, name: 'Implement task moves' });
    // The epic is read with the task, before its tab is opened.
    await waitFor(() => expect(epicReads()).toBe(1));
    await userEvent.click(screen.getByRole('tab', { name: /^Epic/ }));
    expect(await screen.findByText('The epic plan.')).toBeTruthy();
    expect(epicReads()).toBe(1);
    await userEvent.click(taskButton('Restore a board from JSON'));
    await screen.findByRole('heading', { level: 2, name: 'Restore a board from JSON' });
    await userEvent.click(screen.getByRole('tab', { name: /^Epic/ }));
    expect(await screen.findByText('The epic plan.')).toBeTruthy();
    expect(epicReads()).toBe(1);
  });

  it('holds the stream back while the drawer is open and applies it 3 seconds after it closes', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Implement task moves'));
    const summaryReads = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`${PROJECT_A.id}/summary`))
        .length;
    const before = summaryReads();

    setCurrent({ ...current(), tasks: current().tasks.filter((c) => c.id !== 8) });
    act(() => FakeEventSource.latest.changed(PROJECT_A.id));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(summaryReads()).toBe(before);
    expect(screen.getByText('8 tasks')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(summaryReads()).toBe(before);
    expect(screen.getByText('8 tasks')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('7 tasks')).toBeTruthy(), { timeout: 3_500 });
    expect(summaryReads()).toBe(before + 1);
  });

  it('cancels the countdown when a drawer opens again', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(taskButton('Implement task moves'));
    setCurrent({ ...current(), tasks: current().tasks.filter((c) => c.id !== 8) });
    act(() => FakeEventSource.latest.changed(PROJECT_A.id));
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await userEvent.click(taskButton('Implement task moves'));
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(screen.getByText('8 tasks')).toBeTruthy();
  });

  it('shows the empty board message with three empty lanes', async () => {
    setCurrent({ ...current(), tasks: [] });
    show();
    expect(await screen.findByText('No tasks yet.')).toBeTruthy();
    expect(screen.getByText('Add a task to get started.')).toBeTruthy();
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.getByText('0 tasks')).toBeTruthy();
  });

  it('shows the load error with Retry and recovers when retried', async () => {
    backend.boards[PROJECT_A.id] = 500;
    show();
    expect(await screen.findByText('Could not load this board.')).toBeTruthy();
    expect(screen.getByText('Not synced')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' }).getAttribute('data-slot')).toBe('button');
    expect(screen.getByRole('complementary', { name: 'Task details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'agent-board' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();

    backend.boards[PROJECT_A.id] = structuredClone(fixtureBoard);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.queryByText('Could not load this board.')).toBeNull();
  });

  it('keeps showing the board and says Disconnected when the update stream drops', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.getByText(/^Synced \d\d:\d\d$/)).toBeTruthy();

    act(() => FakeEventSource.latest.emit('error'));

    expect(screen.getByText(/^Disconnected · Last synced \d\d:\d\d$/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Doing' })).toBeTruthy();
  });

  it('starts from the sample-data state when given initial values', async () => {
    show({ initial: { select: 11, confirm: true, deleteFail: true } });
    expect(
      await screen.findByText(
        'Archive #11 "Implement task moves"? You can restore it from the archive.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Could not archive the task. Try again.')).toBeTruthy();
    expect(taskButton('Implement task moves').getAttribute('aria-current')).toBe('true');
  });

  it('does not open the sample confirmation for a task selected later', async () => {
    show({ initial: { select: 11, confirm: true } });
    await screen.findByText(/You can restore it from the archive/);
    await userEvent.click(taskButton('Check the board display'));
    expect(screen.queryByText(/You can restore it from the archive/)).toBeNull();
  });
});
