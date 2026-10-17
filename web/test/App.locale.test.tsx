import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../src/i18n';
import type { Board } from '../src/types';
import { FakeEventSource, jsonResponse, stubBackend, type FakeBackend } from './fakes';
import { PROJECTS, PROJECT_A, fixtureBoard } from './fixtures';
import { renderApp } from './renderApp';

describe('language changes in the app', () => {
  let backend: FakeBackend;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    selectLocale('en');
    backend = {
      projects: PROJECTS,
      boards: { [PROJECT_A.id]: structuredClone(fixtureBoard) },
      write: (url, init) => {
        if (url === `/api/projects/${PROJECT_A.id}/tasks/14/archive` && init.method === 'POST') {
          const board = backend.boards[PROJECT_A.id] as Board;
          backend.boards[PROJECT_A.id] = {
            ...board,
            tasks: board.tasks.filter((task) => task.id !== 14),
          };
          return new Response(null, { status: 204 });
        }
        return jsonResponse({}, 404);
      },
    };
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
    fetchMock = stubBackend(backend);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.innerHTML = '';
    selectLocale('en');
    window.localStorage.clear();
  });

  it('keeps the selected task and open archive confirmation when switching languages', async () => {
    renderApp(`?project=${PROJECT_A.id}`);
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: /Prepare the Windows build/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive task' }));
    expect(
      screen.getByText(
        'Archive #14 "Prepare the Windows build"? You can restore it from the archive.',
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: /Prepare the Windows build/ })
        .getAttribute('aria-current'),
    ).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('radio', { name: '日本語' }));
    expect(screen.getByRole('dialog', { name: '設定' })).toBeTruthy();

    expect(
      await screen.findByText(
        '#14「Prepare the Windows build」をアーカイブしますか？ アーカイブ一覧から復元できます。',
      ),
    ).toBeTruthy();
    // The dialog makes the board inert while it is open; closing it must leave everything as it was.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      within(screen.getByRole('complementary')).getByRole('button', { name: 'アーカイブ' }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: /Prepare the Windows build/ })
        .getAttribute('aria-current'),
    ).toBe('true');
    expect(document.documentElement.lang).toBe('ja');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => url === `/api/projects/${PROJECT_A.id}/board`),
      ).toHaveLength(1),
    );
  });
});
