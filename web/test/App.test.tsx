import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { selectLocale } from '../src/i18n';
import type { Board } from '../src/types';
import { FakeEventSource, jsonResponse } from './fakes';
import { fixtureBoard } from './fixtures';

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
    const match = /^\/api\/cards\/(\d+)$/.exec(url);
    if (match && init?.method === 'DELETE') {
      current = { ...current, cards: current.cards.filter((c) => c.id !== Number(match[1])) };
      return new Response(null, { status: 204 });
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  document.title = '';
  selectLocale('en');
  window.localStorage.clear();
});

const lane = (name: string) => screen.getByRole('region', { name });
const cardButton = (title: string) => screen.getByRole('button', { name: new RegExp(title) });

describe('App', () => {
  it('shows Loading… first, then the board with its name in the header and the page title', async () => {
    render(<App />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByText('Connecting…')).toBeTruthy();

    await screen.findByText('agent-board');
    expect(screen.getByRole('heading', { level: 1, name: 'Agent Board' })).toBeTruthy();
    expect(screen.getByText('agent-board')).toBeTruthy();
    expect(document.title).toBe('agent-board - Agent Board');
    expect(screen.getByText('8 cards')).toBeTruthy();
  });

  it('lays the cards out in three lanes with counts, newest Done first', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Todo' });
    const titles = (name: string) =>
      within(lane(name))
        .getAllByRole('button')
        .map((b) => b.querySelector('.card__id')?.textContent);
    expect(titles('Todo')).toEqual(['#14', '#15', '#16']);
    expect(titles('Doing')).toEqual(['#11', '#12', '#13']);
    expect(titles('Done')).toEqual(['#9', '#8']);
    expect(
      within(lane('Done')).getByRole('heading', { name: 'Done' }).nextElementSibling?.textContent,
    ).toBe('2');
  });

  it('shows the details of a clicked card and clears them with Close details', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();

    await userEvent.click(cardButton('Initialize the board'));
    expect(screen.getByRole('heading', { level: 2, name: 'Initialize the board' })).toBeTruthy();
    expect(cardButton('Initialize the board').getAttribute('aria-current')).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
    expect(cardButton('Initialize the board').getAttribute('aria-current')).toBe('false');
  });

  it('switches the details when another card is clicked', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Initialize the board'));
    await userEvent.click(cardButton('Implement card moves'));
    expect(screen.getByRole('heading', { level: 2, name: 'Implement card moves' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Initialize the board' })).toBeNull();
  });

  it('keeps the selection when the board changes and the card still exists', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Implement card moves'));

    current = {
      ...current,
      cards: current.cards.map((c) =>
        c.id === 11 ? { ...c, agentStatus: 'pending' as const, pendingReason: 'Waiting' } : c,
      ),
    };
    act(() => FakeEventSource.latest.emit('changed'));

    await waitFor(() => expect(screen.getAllByText('Pending').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { level: 2, name: 'Implement card moves' })).toBeTruthy();
  });

  it('clears the selection when the selected card disappears', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Initialize the board'));

    current = { ...current, cards: current.cards.filter((c) => c.id !== 8) };
    act(() => FakeEventSource.latest.emit('changed'));

    await waitFor(() => expect(screen.getByText('Select a card to see its details.')).toBeTruthy());
    expect(screen.getByText('7 cards')).toBeTruthy();
  });

  it('deletes a card after confirmation, returns to no selection and fetches the board again', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Prepare the Windows build'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByText('Select a card to see its details.')).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Prepare the Windows build/ })).toBeNull(),
    );
    expect(screen.getByText('7 cards')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/cards/14', {
      method: 'DELETE',
      headers: { 'X-Skan-Token': 'test-token' },
    });
  });

  it('shows the empty board message with three empty lanes', async () => {
    current = { ...current, cards: [] };
    render(<App />);
    expect(await screen.findByText('No cards yet.')).toBeTruthy();
    expect(screen.getByText('Agents add cards with "agboard add <title>".')).toBeTruthy();
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.getByText('0 cards')).toBeTruthy();
  });

  it('shows the load error with Retry and recovers when retried', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: { code: 'database_error', message: 'x', reason: 'y' } }, 500),
    );
    render(<App />);
    expect(await screen.findByText('Could not load the board.')).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();

    fetchMock.mockImplementation(async () => jsonResponse(current));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.queryByText('Could not load the board.')).toBeNull();
  });

  it('keeps showing the board and says Disconnected when the update stream drops', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.getByText(/^Synced \d\d:\d\d$/)).toBeTruthy();

    act(() => FakeEventSource.latest.emit('error'));

    expect(screen.getByText(/^Disconnected · Last synced \d\d:\d\d$/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Doing' })).toBeTruthy();
  });

  it('starts from the sample-data state when given initial values', async () => {
    render(<App initial={{ select: 11, confirm: true, deleteFail: true }} />);
    expect(
      await screen.findByText('Delete #11 "Implement card moves"? This cannot be undone.'),
    ).toBeTruthy();
    expect(screen.getByText('Could not delete the card. Try again.')).toBeTruthy();
    expect(cardButton('Implement card moves').getAttribute('aria-current')).toBe('true');
  });

  it('does not open the sample confirmation for a card selected later', async () => {
    render(<App initial={{ select: 11, confirm: true }} />);
    await screen.findByText(/This cannot be undone/);
    await userEvent.click(cardButton('Check the board display'));
    expect(screen.queryByText(/This cannot be undone/)).toBeNull();
  });
});
