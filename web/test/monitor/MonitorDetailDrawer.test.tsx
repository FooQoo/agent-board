import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { MonitorView } from '../../src/monitor/View';
import type { MonitorReadResolvers, MonitorViewProps } from '../../src/monitor/contracts';
import { makeCard, PROJECT_A } from '../fixtures';
import { shouldIgnoreTabSwipe } from '../../src/monitor/components/MonitorDetailDrawer';
import type { Epic } from '../../src/types';

beforeEach(() => selectLocale('en'));

function required<T>(value: T | null | undefined): Exclude<T, null | undefined> {
  if (value === null || value === undefined) throw new Error('Expected test fixture value.');
  return value as Exclude<T, null | undefined>;
}

const freshness: MonitorViewProps['freshness'] = {
  state: 'fresh',
  lastFetchedAt: '2026-10-12T00:00:00Z',
  failedProjectIds: [],
  snapshotProblems: [],
};

const epic: Epic = {
  id: 'MOB-1',
  name: 'Mobile work',
  color: '#4466aa',
  isDraft: false,
  plan: '---\nname: Mobile work\n---\nEpic body text',
  body: 'Epic body text',
  priority: [],
  priorityError: false,
  attachments: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
};

function setup({
  epicId = 'MOB-1',
  getEpics = vi.fn(async () => [epic]),
}: {
  epicId?: string | null;
  getEpics?: MonitorReadResolvers['getEpics'];
} = {}) {
  const card = makeCard({
    id: 7,
    title: 'Read this card',
    description: 'Card description',
    body: 'Card description',
    epic: epicId ? { id: epicId, name: 'Mobile work', color: '#4466aa' } : null,
    history: [
      {
        id: 'answer-1',
        kind: 'answer',
        actor: 'human',
        reason: 'Keep both options',
        fromCardStatus: 'todo',
        toCardStatus: 'todo',
        fromAgentStatus: 'pending',
        toAgentStatus: 'idle',
        requestId: 'request-7',
        question: 'Which direction?',
        choices: [{ id: 'both', label: 'Keep both' }],
        choiceId: 'both',
        choiceLabel: 'Keep both',
        at: '2026-10-12T08:00:00Z',
      },
    ],
  });
  const item = { projectId: PROJECT_A.id, projectName: PROJECT_A.name, card };
  const readResolvers: MonitorReadResolvers = {
    attachmentUrl: (_project, _card, id) => `/owned/card/${id}`,
    evidenceUrl: (_project, _card, id) => `/owned/evidence/${id}`,
    epicAttachmentUrl: (_project, _epic, id) => `/owned/epic/${id}`,
    getEpics,
  };
  const props: MonitorViewProps = {
    projects: [PROJECT_A],
    scope: 'all',
    summary: { todo: 1, doing: 0, done: 0 },
    todo: [item],
    doing: [],
    done: [],
    freshness,
    onScopeChange: vi.fn(),
    onRefresh: vi.fn(),
    readResolvers,
  };
  return { item, getEpics, props };
}

describe('monitor detail drawer', () => {
  it('opens the body from the card title, links tabs accessibly, and retains each panel in place', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    render(<MonitorView {...props} />);

    await waitFor(() => expect(props.readResolvers?.getEpics).toHaveBeenCalledTimes(1));
    const title = screen.getByRole('button', { name: 'Read this card' });
    await user.click(title);
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.detail__viewport')).toBeNull();
    expect(dialog.getAttribute('data-swipe-direction')).toBe('down');
    const bodyTab = within(dialog).getByRole('tab', { name: 'Body' });
    const historyTab = within(dialog).getByRole('tab', { name: /History/ });
    const epicTab = within(dialog).getByRole('tab', { name: 'Epic' });
    expect(bodyTab.getAttribute('aria-selected')).toBe('true');
    expect(bodyTab.getAttribute('aria-controls')).toBeTruthy();

    const historyPanel = required(
      document.getElementById(required(historyTab.getAttribute('aria-controls'))),
    );
    historyPanel.scrollTop = 73;
    await user.click(historyTab);
    expect(within(historyPanel).getByText('Keep both options')).toBeTruthy();
    expect(historyPanel.getAttribute('aria-hidden')).toBe('false');
    await user.click(bodyTab);
    expect(historyPanel.scrollTop).toBe(73);

    await user.click(epicTab);
    expect(await within(dialog).findByText('Epic body text')).toBeTruthy();
    expect(dialog.querySelector('.monitor-document')).toBeTruthy();
    expect(dialog.querySelector('.md-sections')).toBeNull();
    expect(props.readResolvers?.getEpics).toHaveBeenCalledWith(
      PROJECT_A.id,
      expect.any(AbortSignal),
    );

    await user.keyboard('{ArrowLeft}');
    expect(historyTab.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{End}');
    expect(epicTab.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Home}');
    expect(bodyTab.getAttribute('aria-selected')).toBe('true');
    expect(props.readResolvers?.getEpics).toHaveBeenCalledTimes(1);
  });

  it('opens the epic tab from the epic label and shows an explicit unassigned state', async () => {
    const user = userEvent.setup();
    const linked = setup();
    const { rerender } = render(<MonitorView {...linked.props} />);
    await user.click(screen.getByRole('button', { name: 'MOB-1' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('tab', { name: 'Epic' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await within(dialog).findByText('Epic body text')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const unlinked = setup({ epicId: null });
    rerender(<MonitorView {...unlinked.props} />);
    await user.click(screen.getByRole('button', { name: 'Read this card' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('tab', { name: 'Epic' }));
    expect(
      within(screen.getByRole('dialog')).getByText('This card is not linked to an epic.'),
    ).toBeTruthy();
  });

  it('isolates old epic responses and supports retry and not-found states', async () => {
    const finishOld: { current: (value: Epic[]) => void } = { current: () => {} };
    const oldRequest = new Promise<Epic[]>((resolve) => {
      finishOld.current = resolve;
    });
    const getEpics = vi
      .fn<MonitorReadResolvers['getEpics']>()
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce([{ ...epic, id: 'MOB-2', name: 'Other', body: 'Fresh epic text' }])
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ ...epic, id: 'MOB-2' }]);
    const first = setup({ getEpics });
    const user = userEvent.setup();
    const { rerender } = render(<MonitorView {...first.props} />);
    await user.click(screen.getByRole('button', { name: 'MOB-1' }));
    const dialog = screen.getByRole('dialog');

    const nextEpic = { ...epic, id: 'MOB-2', name: 'Other' };
    const second = setup({ getEpics: vi.fn().mockResolvedValue([nextEpic]) });
    const secondItem = required(second.props.todo[0]);
    const secondResolvers = required(second.props.readResolvers);
    const newItemProps = {
      ...second.props,
      todo: [
        {
          ...secondItem,
          card: { ...secondItem.card, epic: { id: 'MOB-2', name: 'Other', color: '#4466aa' } },
        },
      ],
      readResolvers: { ...secondResolvers, getEpics },
    };
    rerender(<MonitorView {...newItemProps} />);
    await waitFor(() => expect(within(dialog).getByText('Fresh epic text')).toBeTruthy());
    finishOld.current([{ ...epic, body: 'Stale epic text' }]);
    expect(within(dialog).queryByText('Stale epic text')).toBeNull();

    await user.click(within(dialog).getByRole('tab', { name: 'Body' }));
    await user.click(within(dialog).getByRole('tab', { name: 'Epic' }));
    expect(getEpics).toHaveBeenCalledTimes(2);
    rerender(<MonitorView {...newItemProps} readResolvers={{ ...newItemProps.readResolvers }} />);
    await waitFor(() => expect(within(dialog).getByText('Could not load this epic.')).toBeTruthy());
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(dialog).getByText('Epic body text')).toBeTruthy());
  });

  it('closes from the close button, Escape, and backdrop and restores focus to the title', async () => {
    const user = userEvent.setup();
    render(<MonitorView {...setup().props} />);
    const title = screen.getByRole('button', { name: 'Read this card' });
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
    const card = makeCard({
      id: 7,
      title: 'Read this card',
      body: '[A link](https://example.com)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n\n![Preview](attachment:0123456789abcdef0123456789abcdef)',
      attachments: [
        {
          id: '0123456789abcdef0123456789abcdef',
          name: 'Preview',
          mediaType: 'image/png',
          size: 5,
          createdAt: '2026-10-12T00:00:00Z',
        },
      ],
      pendingRequestId: 'request-7',
      agentStatus: 'pending',
      pendingReason: 'Choose one',
      pendingChoices: [{ id: 'a', label: 'A' }],
    });
    const data = setup();
    render(<MonitorView {...data.props} todo={[{ ...required(data.props.todo[0]), card }]} />);
    await user.click(screen.getByRole('button', { name: 'Read this card' }));
    const dialog = screen.getByRole('dialog');
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
    const formButton = required(document.querySelector('.monitor-card__request button'));
    expect(shouldIgnoreTabSwipe(formButton, panel)).toBe(true);
    expect(bodyTab.getAttribute('aria-selected')).toBe('true');
    expect(historyTab.getAttribute('aria-selected')).toBe('false');
  });

  it('distinguishes a deleted epic from a retriable read error', async () => {
    const user = userEvent.setup();
    const getEpics = vi.fn().mockResolvedValue([]);
    render(<MonitorView {...setup({ getEpics }).props} />);
    await user.click(screen.getByRole('button', { name: 'MOB-1' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('This epic is no longer available.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
