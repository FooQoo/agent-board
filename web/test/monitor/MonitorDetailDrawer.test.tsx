import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/shared/i18n';
import { MonitorView } from '../../src/pages/monitor/View';
import { MonitorClientError } from '../../src/pages/monitor/client';
import { createMonitorFixture, createMonitorFixtureProps } from '../../src/pages/monitor/mock';
import {
  createMonitorFixtureAdapter,
  type FixtureAdapterOptions,
} from '../../src/pages/monitor/mock-adapter';
import { shouldIgnoreTabSwipe } from '../../src/pages/monitor/components/MonitorDetailDrawer';
import { DataProvider } from '../../src/shared/data/react';

beforeEach(() => {
  selectLocale('en');
  window.history.replaceState(null, '', '/');
});

function required<T>(value: T | null | undefined): Exclude<T, null | undefined> {
  if (value === null || value === undefined) throw new Error('Expected test fixture value.');
  return value as Exclude<T, null | undefined>;
}

type Request = { kind: 'summary' | 'detail'; detail?: { resource: unknown; sections: string[] } };

/** The fixture's card 1 belongs to the epic MOB-1; card 2 has conditions and no epic. */
function setup(
  options: FixtureAdapterOptions = {},
  edit?: (f: ReturnType<typeof createMonitorFixture>) => void,
) {
  const fixture = createMonitorFixture();
  edit?.(fixture);
  const requests: Request[] = [];
  const adapter = createMonitorFixtureAdapter(fixture, {
    ...options,
    onRequest: (request) => requests.push(request),
  });
  const props = createMonitorFixtureProps(fixture);
  const view = (extra: Partial<typeof props> = {}) => (
    <DataProvider adapter={adapter}>
      <MonitorView {...props} {...extra} />
    </DataProvider>
  );
  const detailRequests = () =>
    requests
      .filter((request) => request.kind === 'detail')
      .map((request) => JSON.stringify(request.detail));
  return { fixture, props, view, requests, detailRequests };
}

const T1 = { kind: 'task', projectId: 'a'.repeat(32), id: 1 };
const E1 = { kind: 'epic', projectId: 'a'.repeat(32), id: 'MOB-1' };
const asked = (resource: unknown, ...sections: string[]) => JSON.stringify({ resource, sections });

describe('monitor detail drawer', () => {
  it('shows the frame, title and tabs at once, then the body when it has arrived', async () => {
    const user = userEvent.setup();
    const data = setup({ detailDelayMs: 100 });
    render(data.view());
    await user.click(screen.getByRole('button', { name: 'Todo work item 1' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Todo work item 1')).toBeTruthy();
    expect(within(dialog).getAllByRole('tab')).toHaveLength(4);
    expect(within(dialog).getByRole('status', { name: 'Loading details…' })).toBeTruthy();
    expect(await within(dialog).findByText('Work')).toBeTruthy();
    expect(within(dialog).queryByRole('status', { name: 'Loading details…' })).toBeNull();
    expect(dialog.querySelector('.monitor-document')).toBeTruthy();
  });

  it('reads nothing for a card that was never opened, and only the active tab afterwards', async () => {
    const user = userEvent.setup();
    const data = setup();
    render(data.view());
    // The list alone asks for no Detail.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(data.detailRequests()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Todo work item 1' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('Work');
    expect(data.detailRequests()).toEqual([asked(T1, 'document')]);

    const historyTab = within(dialog).getByRole('tab', { name: /History/ });
    const bodyTab = within(dialog).getByRole('tab', { name: 'Body' });
    const epicTab = within(dialog).getByRole('tab', { name: 'Epic' });
    // The panels of the tabs that are not active hold nothing.
    const panelOf = (tab: HTMLElement) =>
      required(document.getElementById(required(tab.getAttribute('aria-controls'))));
    expect(panelOf(historyTab).textContent).toBe('');
    expect(panelOf(epicTab).textContent).toBe('');

    await user.click(historyTab);
    await within(dialog).findByText('Created task in Todo.');
    expect(data.detailRequests()).toEqual([asked(T1, 'document'), asked(T1, 'history')]);
    expect(panelOf(bodyTab).textContent).toBe('');

    await user.click(epicTab);
    await within(dialog).findByText('Epic body text');
    expect(data.detailRequests()).toEqual([
      asked(T1, 'document'),
      asked(T1, 'history'),
      asked(E1, 'document'),
    ]);

    // Going back and forth reuses what was read.
    await user.click(bodyTab);
    await user.click(historyTab);
    await user.click(epicTab);
    await user.click(bodyTab);
    await within(dialog).findByText('Work');
    expect(data.detailRequests()).toHaveLength(3);
  });

  it('reuses a read Detail when the drawer is closed and opened again', async () => {
    const user = userEvent.setup();
    const data = setup();
    render(data.view());
    await user.click(screen.getByRole('button', { name: 'Todo work item 1' }));
    await within(screen.getByRole('dialog')).findByText('Work');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Todo work item 1' }));
    expect(await within(screen.getByRole('dialog')).findByText('Work')).toBeTruthy();
    expect(data.detailRequests()).toEqual([asked(T1, 'document')]);
  });

  it('shows the conditions from the document that the body tab shares', async () => {
    const user = userEvent.setup();
    const data = setup();
    render(data.view());
    await user.click(screen.getByRole('button', { name: 'Todo work item 2' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: /Conditions|Acceptance/ }));
    expect(await within(dialog).findByText('Shared display matches')).toBeTruthy();
    await user.click(within(dialog).getByRole('tab', { name: 'Body' }));
    await within(dialog).findByText('Work');
    expect(data.detailRequests()).toHaveLength(1);
  });

  it('tells the page while the drawer is open, so a build reload can wait for it', async () => {
    const user = userEvent.setup();
    const data = setup();
    const onDetailOpenChange = vi.fn();
    const { unmount } = render(data.view({ onDetailOpenChange }));
    expect(onDetailOpenChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole('button', { name: 'Todo work item 1' }));
    expect(onDetailOpenChange).toHaveBeenLastCalledWith(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onDetailOpenChange).toHaveBeenLastCalledWith(false));

    await user.click(screen.getByRole('button', { name: 'Todo work item 1' }));
    expect(onDetailOpenChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onDetailOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('opens the epic tab from the epic label and shows an explicit unassigned state', async () => {
    const user = userEvent.setup();
    const data = setup();
    render(data.view());
    await user.click(screen.getByRole('button', { name: 'MOB-1' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('tab', { name: 'Epic' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await within(dialog).findByText('Epic body text')).toBeTruthy();
    // Only the epic was read: the body tab was never active.
    expect(data.detailRequests()).toEqual([asked(E1, 'document')]);
    await user.click(within(dialog).getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Todo work item 2' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('tab', { name: 'Epic' }));
    expect(
      within(screen.getByRole('dialog')).getByText('This task is not linked to an epic.'),
    ).toBeTruthy();
    expect(data.detailRequests()).toHaveLength(2);
  });

  it('offers a retry for a failed read and keeps the frame', async () => {
    const user = userEvent.setup();
    const data = setup({ failDetail: true });
    render(data.view());
    await user.click(screen.getByRole('button', { name: 'Todo work item 1' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(within(dialog).getAllByRole('tab')).toHaveLength(4);
  });

  it('distinguishes a deleted epic from a retriable read error', async () => {
    const user = userEvent.setup();
    const missing = setup({
      failEpic: true,
      detailError: new MonitorClientError('gone', 404, 'epic_not_found'),
    });
    render(missing.view());
    await user.click(screen.getByRole('button', { name: 'MOB-1' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('This epic is no longer available.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('closes from the close button, Escape, and backdrop and restores focus to the title', async () => {
    const user = userEvent.setup();
    render(setup().view());
    const title = screen.getByRole('button', { name: 'Todo work item 1' });
    await user.click(title);
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close details' });
    await user.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(title);

    await user.click(title);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(title);
    const overlay = required(document.querySelector('[data-slot="drawer-backdrop"]'));
    await user.click(overlay);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not interpret form, link, table, code, or image gestures as tab swipes', async () => {
    const user = userEvent.setup();
    const data = setup({}, (fixture) => {
      const task = required(fixture.tasks.get(3));
      task.summary.title = 'Read this task';
      task.blocks = [
        { kind: 'markdown', text: '[A link](https://example.com)\n' },
        { kind: 'markdown', text: '| A | B |\n| - | - |\n| 1 | 2 |\n' },
        { kind: 'markdown', text: '```ts\nconst x = 1\n```\n' },
        { kind: 'markdown', text: `![Preview](attachment:${'b'.repeat(32)})\n` },
      ];
    });
    render(data.view());
    await user.click(screen.getByRole('button', { name: 'Read this task' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('A link');
    const bodyTab = within(dialog).getByRole('tab', { name: 'Body' });
    const historyTab = within(dialog).getByRole('tab', { name: /History/ });
    const panel = required(
      document.getElementById(required(bodyTab.getAttribute('aria-controls'))),
    );
    for (const selector of ['a', 'table', 'pre', 'img']) {
      const element = panel.querySelector(selector);
      expect(element, selector).toBeTruthy();
      expect(shouldIgnoreTabSwipe(required(element), panel)).toBe(true);
    }
    const nestedDialog = document.createElement('div');
    nestedDialog.setAttribute('role', 'dialog');
    const nestedContent = document.createElement('span');
    nestedDialog.append(nestedContent);
    panel.append(nestedDialog);
    expect(shouldIgnoreTabSwipe(nestedContent, panel)).toBe(true);
    expect(bodyTab.getAttribute('aria-selected')).toBe('true');
    expect(historyTab.getAttribute('aria-selected')).toBe('false');
  });
});
