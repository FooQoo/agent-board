import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../src/i18n';
import type { Board } from '../src/types';
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
      const match = /^\/api\/projects\/([0-9a-f]{32})\/cards\/(\d+)\/archive$/.exec(url);
      if (match?.[1] === PROJECT_A.id && init.method === 'POST') {
        const card = current().cards.find((c) => c.id === Number(match[2]));
        setCurrent({
          ...current(),
          cards: current().cards.filter((c) => c.id !== Number(match[2])),
        });
        return jsonResponse({ card: { ...card, archivedAt: '2026-10-08T00:00:00Z' } });
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
  document.title = '';
  selectLocale('en');
  window.localStorage.clear();
});

const lane = (name: string) => screen.getByRole('region', { name });
const cardButton = (title: string) => screen.getByRole('button', { name: new RegExp(title) });

describe('App', () => {
  it('shows Loading… first, then the board with its name in the header and the page title', async () => {
    show();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Card details' })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'agent-board' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();

    // The project name shows once the list is in; the board follows with its own request.
    await screen.findByText('agent-board');
    expect(document.title).toBe('agent-board - Agent Board');
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.getByRole('complementary', { name: 'Card details' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize card details' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Agent Board' })).toBeTruthy();
    expect(screen.getByText('agent-board')).toBeTruthy();
    expect(document.title).toBe('agent-board - Agent Board');
    expect(screen.getByText('8 cards')).toBeTruthy();
  });

  it('lays the cards out in three lanes with counts, newest Done first', async () => {
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

  it('shows the details of a clicked card and clears them with Close details', async () => {
    show();
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
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Initialize the board'));
    await userEvent.click(cardButton('Implement card moves'));
    expect(screen.getByRole('heading', { level: 2, name: 'Implement card moves' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Initialize the board' })).toBeNull();
  });

  it('keeps the selection when the board changes and the card still exists', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Implement card moves'));

    setCurrent({
      ...current(),
      cards: current().cards.map((c) =>
        c.id === 11 ? { ...c, agentStatus: 'pending' as const, pendingReason: 'Waiting' } : c,
      ),
    });
    act(() => FakeEventSource.latest.emit('changed'));

    await waitFor(() => expect(screen.getAllByText('Pending').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { level: 2, name: 'Implement card moves' })).toBeTruthy();
  });

  it('clears the selection when the selected card disappears', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Initialize the board'));

    setCurrent({ ...current(), cards: current().cards.filter((c) => c.id !== 8) });
    act(() => FakeEventSource.latest.emit('changed'));

    await waitFor(() => expect(screen.getByText('Select a card to see its details.')).toBeTruthy());
    expect(screen.getByText('7 cards')).toBeTruthy();
  });

  it('archives a card after confirmation, returns to no selection and fetches the board again', async () => {
    show();
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(cardButton('Prepare the Windows build'));
    await userEvent.click(screen.getByRole('button', { name: 'Archive card' }));
    await userEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: 'Archive' }),
    );

    await waitFor(() => expect(screen.getByText('Select a card to see its details.')).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Prepare the Windows build/ })).toBeNull(),
    );
    expect(screen.getByText('7 cards')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PROJECT_A.id}/cards/14/archive`, {
      method: 'POST',
      headers: { 'X-Agboard-Token': 'test-token' },
    });
  });

  it('shows the empty board message with three empty lanes', async () => {
    setCurrent({ ...current(), cards: [] });
    show();
    expect(await screen.findByText('No cards yet.')).toBeTruthy();
    expect(screen.getByText('Add a card to get started.')).toBeTruthy();
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.getByText('0 cards')).toBeTruthy();
  });

  it('shows the load error with Retry and recovers when retried', async () => {
    backend.boards[PROJECT_A.id] = 500;
    show();
    expect(await screen.findByText('Could not load this board.')).toBeTruthy();
    expect(screen.getByText('Not synced')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' }).getAttribute('data-slot')).toBe('button');
    expect(screen.getByRole('complementary', { name: 'Card details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'agent-board' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
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
        'Archive #11 "Implement card moves"? You can restore it from the archive.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Could not archive the card. Try again.')).toBeTruthy();
    expect(cardButton('Implement card moves').getAttribute('aria-current')).toBe('true');
  });

  it('does not open the sample confirmation for a card selected later', async () => {
    show({ initial: { select: 11, confirm: true } });
    await screen.findByText(/You can restore it from the archive/);
    await userEvent.click(cardButton('Check the board display'));
    expect(screen.queryByText(/You can restore it from the archive/)).toBeNull();
  });
});
