import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../src/i18n';
import type { Epic, EpicTaskCounts } from '../src/types';
import { FakeEventSource, stubBackend, type FakeBackend } from './fakes';
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

let backend: FakeBackend;

function epic(id: string, name: string): Epic {
  return {
    id,
    name,
    color: '#3366CC',
    isDraft: false,
    plan: `# ${name}\n\nThe plan of ${name}.`,
    body: `# ${name}\n\nThe plan of ${name}.`,
    priority: [],
    priorityError: false,
    attachments: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

const counts = (total: number): EpicTaskCounts => ({
  todo: total,
  doing: 0,
  done: 0,
  archived: 0,
  total,
});

function restart(epics: Epic[], epicTaskCounts: Record<string, EpicTaskCounts>) {
  backend = {
    projects: PROJECTS,
    boards: {
      [PROJECT_A.id]: { ...structuredClone(fixtureBoard), epics, epicTaskCounts },
      [PROJECT_B.id]: boardOf(PROJECT_B, [makeTask({ id: 8, title: 'Other' })], 3),
      [PROJECT_C.id]: boardOf(PROJECT_C, [], 1),
    },
  };
  stubBackend(backend);
}

beforeEach(() => {
  window.localStorage.clear();
  selectLocale('en');
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  window.localStorage.clear();
});

const urlOf = (id: string) => `?project=${id}`;

describe('the epic list in the app shell', () => {
  it('opens from the header, lists every epic in ID order with its counts, and selects one for its details', async () => {
    restart([epic('ZETA', 'Zeta epic'), epic('ALPHA', 'Alpha epic')], {
      ALPHA: counts(2),
      ZETA: counts(0),
    });
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Epics' }));

    const list = await screen.findByRole('list', { name: 'Epics in this project' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('ALPHA'),
      expect.stringContaining('ZETA'),
    ]);
    expect(within(rows[0] as HTMLElement).getByText('Total 2 tasks')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Total 0 tasks')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText('2 epics')).toBeTruthy();
    expect(screen.getByText('2 epics', { selector: '.status-bar__count' })).toBeTruthy();
    // With nothing selected the list takes the full width and no detail column is shown.
    expect(screen.queryByRole('separator', { name: 'Resize task details' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Alpha epic' })).toBeNull();

    await userEvent.click(within(list).getByRole('button', { name: /Alpha epic/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Alpha epic' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize task details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit epic' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Edit epic' }));
    expect((await screen.findByLabelText('Formal name')) as HTMLInputElement).toBeTruthy();
    expect((screen.getByLabelText('Formal name') as HTMLInputElement).value).toBe('Alpha epic');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Alpha epic' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('heading', { level: 2, name: 'Alpha epic' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back to board' }));
    await screen.findByRole('region', { name: 'Todo' });
  });

  it('shows the empty state when the project has no epics', async () => {
    restart([], {});
    renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Epics' }));
    expect(await screen.findByText('No epics yet')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText('0 epics')).toBeTruthy();
  });

  it('leaves the epic list when another project is opened', async () => {
    restart([epic('ALPHA', 'Alpha epic')], { ALPHA: counts(0) });
    const view = renderApp(urlOf(PROJECT_A.id));
    await screen.findByRole('region', { name: 'Todo' });
    await userEvent.click(screen.getByRole('button', { name: 'Epics' }));
    await screen.findByRole('list', { name: 'Epics in this project' });
    view.navigate(urlOf(PROJECT_B.id));
    await screen.findByRole('region', { name: 'Todo' });
    expect(screen.queryByRole('list', { name: 'Epics in this project' })).toBeNull();
  });
});
