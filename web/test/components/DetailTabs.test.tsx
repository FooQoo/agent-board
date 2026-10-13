import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../../src/components/DetailPanel';
import { selectLocale } from '../../src/i18n';
import type { Card } from '../../src/types';
import { PROJECT_A, fixtureCard, makeCard } from '../fixtures';

const noop = () => {};
const noRemove = async () => true;

function renderPanel(card: Card, props: Partial<Parameters<typeof DetailPanel>[0]> = {}) {
  return render(
    <DetailPanel
      projectId={PROJECT_A.id}
      card={card}
      onClose={noop}
      onRemove={noRemove}
      {...props}
    />,
  );
}

const SECTIONED = '## Goal\n- one\n- two\n\n## Steps\n1. first\n2. second\n3. third';

beforeEach(() => selectLocale('en'));

describe('tabs', () => {
  it('has a Description tab and a History tab with the number of history entries', () => {
    renderPanel(fixtureCard(8));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Description', 'History 3', 'Epic']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel')).toBeTruthy();
    expect(screen.queryByRole('list', { name: /history/i })).toBeNull();
  });

  it('shows the history in the History tab and the description again in the Description tab', async () => {
    const { container } = renderPanel(
      makeCard({ ...fixtureCard(8), description: 'Body text', body: 'Body text' }),
    );
    expect(screen.getByRole('tabpanel').textContent).toBe('Body text');
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    expect(screen.getByRole('tabpanel').querySelectorAll('.history__step')).toHaveLength(3);
    expect(container.querySelectorAll('.history__step')).toHaveLength(3);
    expect(screen.getByRole('tabpanel').textContent).not.toContain('Body text');
    await userEvent.click(screen.getByRole('tab', { name: 'Description' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Body text');
  });

  it('moves between the tabs with the arrow keys', async () => {
    renderPanel(fixtureCard(8));
    screen.getByRole('tab', { name: 'Description' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /^History/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^History/ }));
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Description' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('shows the empty note for an empty description', () => {
    renderPanel(fixtureCard(12));
    expect(screen.getByRole('tabpanel').textContent).toBe('No description.');
  });

  it('puts the tabs below the header and the request area', () => {
    const { container } = renderPanel(fixtureCard(12));
    const order = Array.from(container.querySelector('.detail')?.children ?? []).map(
      (el) => el.className.split(' ')[0],
    );
    expect(order).toEqual([
      'detail__top',
      'detail__title',
      'detail__meta',
      'detail__request',
      'detail__tabs',
      'detail__viewport',
      'detail__viewport',
      'detail__viewport',
      'detail__dock',
    ]);
  });
});

describe('chapters of the description', () => {
  it('shows each H2 chapter as a plain heading and keeps every chapter open, with no fold control', async () => {
    const { container } = renderPanel(makeCard({ id: 50, description: `Intro\n\n${SECTIONED}` }));
    expect(container.querySelector('.md-chapter__number')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Goal' })).toBeTruthy();
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('Intro')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Goal/ })).toBeNull();
    // The chapters have no fold control; the conditions dock below the panel is the only one.
    expect(container.querySelector('.detail__viewport [aria-expanded]')).toBeNull();
  });

  it('keeps every chapter visible when the History tab is looked at and back', async () => {
    renderPanel(makeCard({ id: 50, description: SECTIONED }));
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Description' }));
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Goal' })).toBeTruthy();
  });

  it('returns to the Description tab when another card is shown', async () => {
    const { rerender } = renderPanel(fixtureCard(8));
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(9)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Description' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('toolbar', () => {
  const names = () =>
    within(screen.getByRole('toolbar'))
      .getAllByRole('button')
      .map((b) => b.textContent || b.getAttribute('aria-label'));

  it('offers Make draft and Delete for an idle card that is not a draft, Delete last', () => {
    renderPanel(fixtureCard(8));
    expect(names()).toEqual(['Make draft', 'Archive card']);
  });

  it('offers the edit icon and Delete for a draft', () => {
    renderPanel({ ...fixtureCard(8), isDraft: true });
    expect(names()).toEqual(['Edit card', 'Archive card']);
  });

  it('offers Make draft for pending cards but only Delete for running cards', () => {
    const { rerender } = renderPanel(fixtureCard(11));
    expect(names()).toEqual(['Archive card']);
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(12)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(names()).toEqual(['Make draft', 'Archive card']);
  });

  it('offers Make draft to an idle card that has no run state of its own (Todo)', () => {
    renderPanel(fixtureCard(14));
    expect(names()).toEqual(['Make draft', 'Archive card']);
  });

  it('shows only Delete in the History tab', async () => {
    renderPanel({ ...fixtureCard(8), isDraft: true });
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    expect(names()).toEqual(['Archive card']);
  });

  it('calls onEdit with the card when the edit icon is pressed', async () => {
    const onEdit = vi.fn();
    const card = { ...fixtureCard(8), isDraft: true };
    renderPanel(card, { onEdit });
    await userEvent.click(screen.getByRole('button', { name: 'Edit card' }));
    expect(onEdit).toHaveBeenCalledWith(card);
  });

  it('opens the delete confirmation above the tabs', async () => {
    const { container } = renderPanel(fixtureCard(8));
    await userEvent.click(screen.getByRole('button', { name: 'Archive card' }));
    const confirm = container.querySelector('.delete-confirm') as HTMLElement;
    const tabs = container.querySelector('.detail__tabs') as HTMLElement;
    expect(confirm.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Description' })).toBeTruthy();
  });

  it('places restore and delete above the content tabs and removes the normal toolbar', async () => {
    const onRestore = vi.fn();
    const onRemove = vi.fn(async () => true);
    const { container } = renderPanel(fixtureCard(8), { archived: true, onRestore, onRemove });
    const detail = container.querySelector('.detail') as HTMLElement;
    const order = Array.from(detail.children).map((element) => element.className.split(' ')[0]);
    expect(order).toEqual([
      'detail__top',
      'detail__title',
      'detail__meta',
      'detail__archive-actions',
      'detail__tabs',
      'detail__viewport',
      'detail__viewport',
      'detail__viewport',
      'detail__dock',
    ]);
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete card' }).textContent).toContain('Delete');
    expect(screen.queryByRole('toolbar')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('uses the inline delete confirmation to call the lifecycle action and explains removed data', async () => {
    const onRemove = vi.fn(async () => true);
    renderPanel(fixtureCard(8), { archived: true, onRemove });
    await userEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    expect(screen.getByText(/description, images, and history/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onRemove).toHaveBeenCalledWith('delete', fixtureCard(8));
  });

  it('matches the Pen Japanese delete confirmation copy', async () => {
    selectLocale('ja');
    renderPanel(fixtureCard(8), { archived: true, onRemove: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'カードを削除' }));
    expect(
      screen.getByText(
        '#8「Initialize the board」を削除しますか？ 本文・画像・履歴も削除されます。この操作は元に戻せません。',
      ),
    ).toBeTruthy();
    selectLocale('en');
  });

  it('shows restore failure in the selected detail and disables actions while saving', () => {
    renderPanel(fixtureCard(8), {
      archived: true,
      onRestore: vi.fn(),
      restoreFailed: true,
      operationSaving: true,
    });
    expect(screen.getByRole('alert').textContent).toBe('Could not restore the card. Try again.');
    expect(screen.getByRole('button', { name: 'Restore' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete card' }).hasAttribute('disabled')).toBe(true);
  });

  it('names the toolbar buttons in Japanese', () => {
    selectLocale('ja');
    renderPanel({ ...fixtureCard(8), isDraft: true });
    expect(names()).toEqual(['カードを編集', 'カードをアーカイブ']);
  });

  it('shows the archived delete label in Japanese', () => {
    selectLocale('ja');
    renderPanel(fixtureCard(8), { archived: true, onRestore: vi.fn() });
    const deleteButton = screen.getByRole('button', { name: 'カードを削除' });
    expect(deleteButton.textContent).toContain('削除');
  });
});

describe('epic tab', () => {
  const EPIC_LINKED = {
    id: 'FILE-SHARE',
    name: 'File share',
    color: '#7C3AED',
    isDraft: false,
    plan: '## Plan\n\nEpic plan text.',
    body: '## Plan\n\nEpic plan text.',
    acceptance: [{ id: 'AC-1', text: 'Epic condition', done: true }],
    acceptanceError: false,
    priority: [],
    priorityError: false,
    attachments: [],
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
  };
  const linked = (id: number) =>
    makeCard({ id, epic: { id: 'FILE-SHARE', name: 'File share', color: '#7C3AED' } });

  it('says that a card without an epic belongs to none', async () => {
    renderPanel(makeCard({ id: 60, epic: null }), { epics: [] });
    await userEvent.click(screen.getByRole('tab', { name: /^Epic/ }));
    expect(screen.getByText('This card belongs to no epic.')).toBeTruthy();
  });

  it('shows the epic plan of the card in the epic tab', async () => {
    renderPanel(linked(61), { epics: [EPIC_LINKED] });
    await userEvent.click(screen.getByRole('tab', { name: /^Epic/ }));
    expect(screen.getByText('Epic plan text.')).toBeTruthy();
  });

  it('shows the epic conditions in the dock at the bottom, folded until opened', async () => {
    const { container } = renderPanel(linked(62), { epics: [EPIC_LINKED] });
    await userEvent.click(screen.getByRole('tab', { name: /^Epic/ }));
    const dock = container.querySelector('.detail__dock') as HTMLElement;
    const head = within(dock).getByRole('button', { name: /^Acceptance conditions/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(head);
    expect(within(dock).getByText('Epic condition')).toBeTruthy();
  });

  it('shows that the epic is still loading, and offers to try again when it cannot be read', async () => {
    const onRetryEpics = vi.fn();
    const { rerender } = renderPanel(linked(63), { epics: undefined });
    await userEvent.click(screen.getByRole('tab', { name: /^Epic/ }));
    expect(screen.getByText('Loading the epic…')).toBeTruthy();

    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={linked(63)}
        onClose={noop}
        onRemove={noRemove}
        epics={[]}
        epicsFailed
        onRetryEpics={onRetryEpics}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('The epic could not be read.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryEpics).toHaveBeenCalledTimes(1);
  });
});
