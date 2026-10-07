import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../src/i18n';
import type { Card } from '../src/types';
import { FakeEventSource, deferred, jsonResponse, stubBackend, type FakeBackend } from './fakes';
import {
  PROJECTS,
  PROJECT_A,
  PROJECT_B,
  PROJECT_C,
  boardOf,
  fixtureBoard,
  makeCard,
} from './fixtures';
import { renderApp } from './renderApp';

const missing = 'e'.repeat(32);
const cardsOfB: Card[] = [
  makeCard({ id: 8, title: 'Eight in knowledge', cardStatus: 'doing' }),
  makeCard({ id: 12, title: 'Twelve in knowledge', cardStatus: 'todo' }),
];

let backend: FakeBackend;
let fetchMock: ReturnType<typeof stubBackend>;

function restart() {
  backend = {
    projects: PROJECTS,
    boards: {
      [PROJECT_A.id]: structuredClone(fixtureBoard),
      [PROJECT_B.id]: boardOf(PROJECT_B, cardsOfB, 3),
      [PROJECT_C.id]: boardOf(PROJECT_C, [], 1),
    },
  };
  fetchMock = stubBackend(backend);
}

beforeEach(() => {
  window.localStorage.clear();
  selectLocale('en');
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  document.head.innerHTML = '<meta name="skan-token" content="test-token">';
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
const cardButton = (title: string) => screen.getByRole('button', { name: new RegExp(title) });
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
      `/api/projects/${PROJECT_A.id}/board`,
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
    expect(screen.getByText('2 cards')).toBeTruthy();
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

  it('clears the selected card and does not carry a card number into the other project', async () => {
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Initialize the board'));
    expect(screen.getByRole('heading', { level: 2, name: 'Initialize the board' })).toBeTruthy();

    await choose('agent-board', 'knowledge');

    await screen.findByText('Eight in knowledge');
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
    const details = screen.getByRole('complementary', { name: 'Card details' });
    expect(within(details).queryByRole('heading')).toBeNull();
    expect(cardButton('Eight in knowledge').getAttribute('aria-current')).toBe('false');

    await userEvent.click(cardButton('Eight in knowledge'));
    expect(screen.getByRole('heading', { level: 2, name: 'Eight in knowledge' })).toBeTruthy();
  });

  it('follows back and forward: the URL change applies the same switching rules', async () => {
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Initialize the board'));

    app.navigate(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();

    app.navigate(urlOf(PROJECT_A.id));
    await screen.findByText('Initialize the board');
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
    expect(app.updates()).toHaveLength(0);
  });

  it('keeps showing the same project, by ID, when it is renamed', async () => {
    renderApp(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    await userEvent.click(cardButton('Eight in knowledge'));

    backend.projects = [PROJECT_A, { ...PROJECT_B, name: 'renamed' }, PROJECT_C];
    act(() => FakeEventSource.latest.emit('changed'));

    await screen.findByRole('button', { name: 'renamed' });
    expect(screen.getByRole('heading', { level: 2, name: 'Eight in knowledge' })).toBeTruthy();
    expect(document.title).toBe('renamed - Agent Board');
  });
});

describe('states', () => {
  it('shows Loading board… with the switcher and an empty detail area while the board loads', async () => {
    const gate = deferred();
    backend.gate = (url) => (url.endsWith('/board') ? gate.promise : undefined);
    renderApp(urlOf(PROJECT_B.id));

    expect(await screen.findByText('Loading board…')).toBeTruthy();
    expect(switcher('knowledge')).toBeTruthy();
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();

    await choose('knowledge', 'agent-board');
    await screen.findByRole('region', { name: 'Todo' });
    await choose('agent-board', 'knowledge');
    expect(await screen.findByText('Could not load this board.')).toBeTruthy();

    backend.boards[PROJECT_B.id] = boardOf(PROJECT_B, cardsOfB, 4);
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
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
    expect(app.updates()).toHaveLength(0);
  });

  it('shows Project not found for an invalid ID, never redirects, and recovers from the menu', async () => {
    const app = renderApp('?project=not-an-id');
    expect(await screen.findByText('Project not found')).toBeTruthy();
    expect(screen.getByText(/Choose another project from the menu/)).toBeTruthy();
    expect(switcher('Choose a project')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
    expect(app.updates()).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/board'))).toBe(false);

    await choose('Choose a project', 'tech-blog');
    await screen.findByText('No cards yet.');
    expect(app.updates().at(-1)?.searchParams.get('project')).toBe(PROJECT_C.id);
  });

  it('shows Project not found for an ID that is not in the list and does not ask its board', async () => {
    renderApp(urlOf(missing));
    expect(await screen.findByText('Project not found')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(`/api/projects/${missing}/board`, expect.anything());
  });

  it('turns into Project not found when the shown project is deleted, and lists the rest', async () => {
    renderApp(urlOf(PROJECT_B.id));
    await screen.findByText('Eight in knowledge');
    await userEvent.click(cardButton('Eight in knowledge'));

    backend.projects = [PROJECT_A, PROJECT_C];
    backend.boards[PROJECT_B.id] = 'not_found';
    act(() => FakeEventSource.latest.emit('changed'));

    expect(await screen.findByText('Project not found')).toBeTruthy();
    expect(screen.queryByText('Eight in knowledge')).toBeNull();
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
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
    act(() => FakeEventSource.latest.emit('changed'));
    expect(await screen.findByText('No projects yet')).toBeTruthy();
  });

  it('shows the empty board of a project with no cards', async () => {
    renderApp(urlOf(PROJECT_C.id));
    expect(await screen.findByText('No cards yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add card' })).toBeTruthy();
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
      url.includes(PROJECT_A.id) && url.endsWith('/board') ? lateA.promise : undefined;
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
    const boardsOfA = count(`${PROJECT_A.id}/board`);

    act(() => FakeEventSource.latest.emit('changed'));
    await waitFor(() => expect(count('/api/projects')).toBe(lists + 1));
    expect(count(`${PROJECT_A.id}/board`)).toBe(boardsOfA + 1);
    expect(count(`${PROJECT_B.id}/board`)).toBe(0);

    act(() => FakeEventSource.latest.emit('error'));
    expect(screen.getByText(/^Disconnected · Last synced/)).toBeTruthy();
    act(() => FakeEventSource.latest.emit('ready'));
    await waitFor(() => expect(count('/api/projects')).toBe(lists + 2));
    await waitFor(() => expect(screen.getByText(/^Synced/)).toBeTruthy());
  });
});

async function openCreateForm() {
  await userEvent.click(screen.getByRole('button', { name: 'Add card' }));
  return screen.getByRole('dialog');
}

describe('switching while a form is open', () => {
  it('disables the switcher and Add card while the add form is open', async () => {
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
    await userEvent.type(within(dialog).getByLabelText('Title (required)'), 'Half written');

    app.navigate(urlOf(PROJECT_C.id));
    app.navigate(urlOf(PROJECT_B.id));
    await act(async () => {});

    expect(within(screen.getByRole('dialog')).getByLabelText('Title (required)')).toHaveProperty(
      'value',
      'Half written',
    );
    expect(document.body.textContent).toContain('Initialize the board');
    expect(document.body.textContent).not.toContain('Eight in knowledge');

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    await screen.findByText('Eight in knowledge');
    expect(switcher('knowledge')).toBeTruthy();
    expect(app.updates()).toHaveLength(0);
  });

  it('writes to the project the form was opened in, then shows the project the URL moved to', async () => {
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    const dialog = await openCreateForm();
    await userEvent.type(within(dialog).getByLabelText('Title (required)'), 'New card');

    app.navigate(urlOf(PROJECT_B.id));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create card' }),
    );

    await screen.findByText('Eight in knowledge');
    const posts = writes();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe(`/api/projects/${PROJECT_A.id}/cards`);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
      title: 'New card',
      description: '',
      assignee: 'ai',
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
    await userEvent.type(within(dialog).getByLabelText('Title (required)'), 'Keep me');
    app.navigate(urlOf(PROJECT_B.id));

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create card' }),
    );

    expect(await screen.findByText('The board is busy.')).toBeTruthy();
    const open = screen.getByRole('dialog');
    expect(within(open).getByLabelText('Title (required)')).toHaveProperty('value', 'Keep me');
    expect(document.body.textContent).toContain('Initialize the board');

    backend.write = undefined;
    await userEvent.click(within(open).getByRole('button', { name: 'Create card' }));
    await screen.findByText('Eight in knowledge');
  });

  it('sends an answer to the project where the answer form was opened, with that card number', async () => {
    const pendingA = fixtureBoard.cards.find((card) => card.agentStatus === 'pending');
    expect(pendingA).toBeTruthy();
    backend.boards[PROJECT_B.id] = boardOf(
      PROJECT_B,
      [makeCard({ id: pendingA?.id ?? 12, title: 'Same number elsewhere' })],
      2,
    );
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton(pendingA?.title ?? ''));
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
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
    expect(posts[0]?.[0]).toBe(`/api/projects/${PROJECT_A.id}/cards/${pendingA?.id}/answer`);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({
      requestId: pendingA?.pendingRequestId,
      reason: 'Go ahead',
    });
  });

  it('keeps the project and the confirmation open while a delete confirmation is open, and deletes in that project', async () => {
    const app = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Prepare the Windows build'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    expect(
      (screen.getByRole('button', { name: 'agent-board' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Add card' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    app.navigate(urlOf(PROJECT_B.id));
    await act(async () => {});
    expect(screen.getByText(/Delete #14/)).toBeTruthy();
    expect(screen.queryByText('Eight in knowledge')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await screen.findByText('Eight in knowledge');
    const calls = writes();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(`/api/projects/${PROJECT_A.id}/cards/14`);
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
  });

  it('lets the user switch again after the delete confirmation is cancelled', async () => {
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Prepare the Windows build'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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
  const hint = 'カードを選択すると詳細が表示されます。';

  it('board loading', async () => {
    selectLocale('ja');
    const gate = deferred();
    backend.gate = (url) => (url.endsWith('/board') ? gate.promise : undefined);
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
    expect(screen.getByText('カードを選択すると詳細を表示します。')).toBeTruthy();
  });
});
