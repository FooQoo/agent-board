import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { selectLocale } from '../src/i18n';
import type { Board } from '../src/types';
import { FakeEventSource, jsonResponse } from './fakes';
import { fixtureBoard } from './fixtures';

describe('language changes in the app', () => {
  let current: Board;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    selectLocale('en');
    current = structuredClone(fixtureBoard);
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    document.head.innerHTML = '<meta name="skan-token" content="test-token">';
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/board') return jsonResponse(current);
      if (url === '/api/cards/14' && init?.method === 'DELETE') {
        current = { ...current, cards: current.cards.filter((card) => card.id !== 14) };
        return new Response(null, { status: 204 });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.innerHTML = '';
    selectLocale('en');
    window.localStorage.clear();
  });

  it('keeps the selected card and open delete confirmation when switching languages', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: /Prepare the Windows build/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    expect(
      screen.getByText('Delete #14 "Prepare the Windows build"? This cannot be undone.'),
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
        '#14「Prepare the Windows build」を削除しますか？ この操作は元に戻せません。',
      ),
    ).toBeTruthy();
    // The dialog makes the board inert while it is open; closing it must leave everything as it was.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '削除' })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: /Prepare the Windows build/ })
        .getAttribute('aria-current'),
    ).toBe('true');
    expect(document.documentElement.lang).toBe('ja');
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/board')).toHaveLength(1),
    );
  });
});
