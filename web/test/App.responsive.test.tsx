import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../src/shared/i18n';
import { NARROW_VIEWPORT_QUERY } from '../src/shared/lib/viewport/useNarrowViewport';
import { FakeEventSource, jsonResponse, stubBackend, type FakeBackend } from './fakes';
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

type Listener = () => void;

/** A window whose width a test sets by hand: `matchMedia` answers for it and tells its listeners. */
function stubViewport(narrow: boolean) {
  const state = { narrow };
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() {
      return media === NARROW_VIEWPORT_QUERY ? state.narrow : false;
    },
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    dispatchEvent: () => false,
  }));
  return {
    resize: (next: boolean) =>
      act(() => {
        state.narrow = next;
        for (const listener of [...listeners]) listener();
      }),
    listeners: () => listeners.size,
  };
}

const pendingTask = fixtureBoard.tasks.find((task) => task.agentStatus === 'pending');
const withCondition = makeTask({
  id: 90,
  title: 'Has a condition',
  taskStatus: 'todo',
  acceptance: [{ id: 'c1', text: 'The condition holds', done: false }],
});

let backend: FakeBackend;
let fetchMock: ReturnType<typeof stubBackend>;

beforeEach(() => {
  window.localStorage.clear();
  selectLocale('en');
  FakeEventSource.reset(true);
  vi.stubGlobal('EventSource', FakeEventSource);
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
  backend = {
    projects: PROJECTS,
    boards: {
      [PROJECT_A.id]: boardOf(PROJECT_A, [...fixtureBoard.tasks, withCondition], 20),
      [PROJECT_B.id]: boardOf(
        PROJECT_B,
        [makeTask({ id: 8, title: 'Eight in knowledge', taskStatus: 'doing' })],
        3,
      ),
      [PROJECT_C.id]: boardOf(PROJECT_C, [], 1),
    },
  };
  fetchMock = stubBackend(backend);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  document.title = '';
  window.localStorage.clear();
});

const lanes = () => screen.queryByRole('region', { name: 'Todo' });
const phone = () => document.querySelector('.monitor-shell');
const answerButtonOf = (taskId: number) =>
  document.querySelector(`[data-decision-answer][data-task-id="${taskId}"]`) as HTMLElement;
const requests = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === method);

describe('the board at a narrow and a wide window', () => {
  it('shows the phone screen below 768px and the lanes at and above it', async () => {
    const viewport = stubViewport(true);
    renderApp(`?project=${PROJECT_A.id}`);
    await screen.findByRole('button', { name: /Has a condition/ });
    expect(phone()).not.toBeNull();
    expect(lanes()).toBeNull();
    expect(document.querySelector('.app')?.getAttribute('data-layout')).toBe('mobile');

    await viewport.resize(false);
    await screen.findByRole('region', { name: 'Todo' });
    expect(phone()).toBeNull();
    expect(document.querySelector('.app')?.getAttribute('data-layout')).toBe('desktop');
  });

  it('shows the lanes when the window is wide from the start, and stops listening on unmount', async () => {
    const viewport = stubViewport(false);
    const app = renderApp(`?project=${PROJECT_A.id}`);
    await screen.findByRole('region', { name: 'Todo' });
    expect(phone()).toBeNull();
    expect(viewport.listeners()).toBeGreaterThan(0);
    app.unmount();
    expect(viewport.listeners()).toBe(0);
  });

  it('keeps the selected project across a change of width, and lets the phone switch it', async () => {
    const viewport = stubViewport(false);
    renderApp(`?project=${PROJECT_B.id}`);
    await screen.findByText('Eight in knowledge');

    await viewport.resize(true);
    await screen.findByRole('button', { name: /Eight in knowledge/ });
    await userEvent.click(screen.getByRole('button', { name: 'knowledge' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'agent-board' }));
    await screen.findByRole('button', { name: /Has a condition/ });

    await viewport.resize(false);
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.getByRole('button', { name: 'agent-board' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Has a condition/ })).toBeTruthy();
  });

  it('keeps an answer held but not sent across a change of width', async () => {
    const viewport = stubViewport(true);
    renderApp(`?project=${PROJECT_A.id}`);
    await screen.findByRole('button', { name: /Has a condition/ });
    await userEvent.click(answerButtonOf(pendingTask?.id ?? 0));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(await within(dialog).findByRole('textbox', { name: 'Note' }), 'Go ahead');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(answerButtonOf(pendingTask?.id ?? 0).textContent).toBe('Continue answering');

    await viewport.resize(false);
    await screen.findByRole('region', { name: 'Todo' });
    expect(answerButtonOf(pendingTask?.id ?? 0).textContent).toBe('Continue answering');
    expect(screen.getByRole('button', { name: 'Review and send' })).toBeTruthy();

    await viewport.resize(true);
    await screen.findByRole('button', { name: /Has a condition/ });
    expect(answerButtonOf(pendingTask?.id ?? 0).textContent).toBe('Continue answering');
    expect(requests('POST')).toHaveLength(0);
  });
});

describe('writes from the phone screen go to the board routes', () => {
  it('sends an answer through the board answer route with the page token', async () => {
    stubViewport(true);
    renderApp(`?project=${PROJECT_A.id}`);
    await screen.findByRole('button', { name: /Has a condition/ });
    await userEvent.click(answerButtonOf(pendingTask?.id ?? 0));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(await within(dialog).findByRole('textbox', { name: 'Note' }), 'Go ahead');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Send$/ }));

    await waitFor(() => expect(requests('POST')).toHaveLength(1));
    const [url, init] = requests('POST')[0] ?? [];
    expect(url).toBe(`/api/projects/${PROJECT_A.id}/qa/answers`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      answers: [{ questionId: pendingTask?.pendingRequestId, text: 'Go ahead' }],
    });
    expect(new Headers(init?.headers).get('X-Agboard-Token')).toBe('test-token');
    expect(fetchMock.mock.calls.some(([target]) => String(target).includes('/monitor/api'))).toBe(
      false,
    );
  });

  it('toggles an acceptance condition through the board route', async () => {
    stubViewport(true);
    backend.write = (url) =>
      url === `/api/projects/${PROJECT_A.id}/tasks/90/acceptance/c1`
        ? jsonResponse({ task: { ...withCondition }, changed: true })
        : jsonResponse({}, 404);
    renderApp(`?project=${PROJECT_A.id}`);
    await userEvent.click(await screen.findByRole('button', { name: /Has a condition/ }));
    await userEvent.click(await screen.findByRole('tab', { name: /Conditions/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /The condition holds/ }));

    await waitFor(() => expect(requests('PUT')).toHaveLength(1));
    const [url, init] = requests('PUT')[0] ?? [];
    expect(url).toBe(`/api/projects/${PROJECT_A.id}/tasks/90/acceptance/c1`);
    expect(JSON.parse(String(init?.body))).toEqual({ done: true });
    expect(new Headers(init?.headers).get('X-Agboard-Token')).toBe('test-token');
  });

  it('saves the language through the board preferences route', async () => {
    stubViewport(true);
    backend.write = (url, init) =>
      url === '/api/preferences'
        ? jsonResponse({
            locale: JSON.parse(String(init.body)).locale,
            theme: { mode: 'light', accent: 'indigo' },
            revision: 1,
          })
        : jsonResponse({}, 404);
    renderApp(`?project=${PROJECT_A.id}`);
    await screen.findByRole('button', { name: /Has a condition/ });
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(await screen.findByRole('radio', { name: /日本語/ }));

    await waitFor(() => expect(requests('PUT')).toHaveLength(1));
    const [url, init] = requests('PUT')[0] ?? [];
    expect(url).toBe('/api/preferences');
    expect(JSON.parse(String(init?.body))).toMatchObject({ locale: 'ja' });
    expect(new Headers(init?.headers).get('X-Agboard-Token')).toBe('test-token');
  });
});
