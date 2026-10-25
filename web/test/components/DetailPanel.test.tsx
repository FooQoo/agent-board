import { screen, waitFor, within } from '@testing-library/react';
import { renderDetail } from '../renderDetail';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../../src/features/tasks/detail/DetailPanel';
import { selectLocale } from '../../src/shared/i18n';
import { PROJECT_A, fixtureTask, makeTask } from '../fixtures';

const noop = () => {};
const noRemove = async () => true;

/** Opens the History tab and waits for the log to be read. */
async function openHistory() {
  await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
}

describe('DetailPanel', () => {
  beforeEach(() => selectLocale('en'));

  it('translates the detail region, empty selection, headings, and accessible controls', async () => {
    selectLocale('ja');
    const { rerender } = renderDetail(
      <DetailPanel projectId={PROJECT_A.id} task={null} onClose={noop} onRemove={noRemove} />,
    );
    expect(screen.getByRole('complementary', { name: 'タスクの詳細' })).toBeTruthy();
    expect(screen.getByText('タスクを選択すると詳細を表示します。')).toBeTruthy();

    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(15)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(screen.getByRole('button', { name: '詳細を閉じる' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'タスクをアーカイブ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下書きにする' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '本文' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^履歴/ })).toBeTruthy();
    expect(await screen.findByText('説明はありません。')).toBeTruthy();
    selectLocale('en');
  });

  it('asks for a selection when no task is selected', () => {
    renderDetail(
      <DetailPanel projectId={PROJECT_A.id} task={null} onClose={noop} onRemove={noRemove} />,
    );
    expect(screen.getByText('Select a task to see its details.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Archive task' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close details' })).toBeNull();
  });

  it('shows the id, title, column and description of the selected task, and its history once opened', async () => {
    const { container } = renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(8)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(screen.getByText('#8')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Initialize the board' })).toBeTruthy();
    expect(container.querySelector('.detail__meta .status-label--done')?.textContent).toBe('Done');
    expect(screen.getByRole('tab', { name: 'Description', selected: true })).toBeTruthy();
    expect(
      await screen.findByText('Create the storage for the board with agboard init.'),
    ).toBeTruthy();
    // The whole task is read when the drawer opens, so the count is known before the tab is opened.
    expect(await screen.findByRole('tab', { name: /^History 3$/ })).toBeTruthy();
    await openHistory();
    expect(screen.getByRole('tab', { name: 'History 3', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive task' })).toBeTruthy();
  });

  it('shows every line break and shows markup as text', async () => {
    const task = makeTask({ id: 31, description: 'Line one\nLine **two**\n<b>three</b>' });
    const { container } = renderDetail(
      <DetailPanel projectId={PROJECT_A.id} task={task} onClose={noop} onRemove={noRemove} />,
    );
    await screen.findByText(/Line one/);
    const panel = screen.getByRole('tabpanel');
    expect(panel.querySelectorAll('br')).toHaveLength(2);
    expect(panel.querySelector('strong')?.textContent).toBe('two');
    expect(panel.textContent).toContain('<b>three</b>');
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows a note when the description is empty', async () => {
    renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(12)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(await screen.findByText('No description.')).toBeTruthy();
  });

  it('draws one history point per event with only the recorded datetime and reason', async () => {
    const { container } = renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(8)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    await openHistory();
    const steps = container.querySelectorAll('.history__step');
    expect(steps).toHaveLength(3);
    const texts = Array.from(steps).map((step) => step.textContent);
    expect(texts).toEqual([
      '10/02 09:48Moved task from Doing to Done.',
      '10/01 16:30Moved task from Todo to Doing.',
      '10/01 16:00Created task in Todo.',
    ]);
    expect(steps[0]?.getAttribute('data-column')).toBeNull();
    expect(steps[2]?.getAttribute('data-column')).toBeNull();
  });

  it('adds a point when a task returned to an earlier column', async () => {
    const task = makeTask({
      id: 32,
      taskStatus: 'doing',
      history: [
        { at: '2026-10-01T16:00:00Z', reason: 'Created task in Todo.' },
        { at: '2026-10-01T16:30:00Z', reason: 'move' },
        { at: '2026-10-01T17:00:00Z', reason: 'move' },
        { at: '2026-10-01T18:00:00Z', reason: 'move' },
      ],
    });
    const { container } = renderDetail(
      <DetailPanel projectId={PROJECT_A.id} task={task} onClose={noop} onRemove={noRemove} />,
    );
    await openHistory();
    expect(container.querySelectorAll('.history__step')).toHaveLength(4);
  });

  it('shows Running and Pending states without duplicating the answer prompt', () => {
    const { rerender } = renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(11)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(document.querySelector('.detail__meta .status-label--running')?.textContent).toBe(
      'Running',
    );
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(12)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(document.querySelector('.detail__meta .status-label--pending')?.textContent).toBe(
      'Pending',
    );
    expect(document.querySelector('.detail__request')).toBeNull();
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(8)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(screen.queryByText('Idle')).toBeNull();
  });

  it('closes with the Close details button', async () => {
    const onClose = vi.fn();
    renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(8)}
        onClose={onClose}
        onRemove={noRemove}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the panel as a labelled region', () => {
    renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(8)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    const region = screen.getByRole('complementary');
    expect(within(region).getByText('#8')).toBeTruthy();
  });

  it('puts the datetime first and the reason next without inferred tags', async () => {
    const { container } = renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(8)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    await openHistory();
    const step = container.querySelector('.history__step') as HTMLElement;
    const parts = Array.from(step.querySelectorAll('.history__text > *')).map((el) => el.className);
    expect(parts).toEqual(['history__at', 'history__reason']);
    expect(step.querySelector('.status-label')).toBeNull();
    expect(step.querySelector('.assignee-label')).toBeNull();
  });

  it('shows the status icons in the detail too and spins none of them outside the board', () => {
    const { container } = renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(8)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(container.querySelector('.detail__meta .status-label svg.lucide-check')).not.toBeNull();
    expect(container.querySelector('.detail__title')?.tagName).toBe('H2');
  });

  it('names the assignee next to the icon in the detail header', () => {
    const { container } = renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(8)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    const meta = container.querySelector('.detail__meta') as HTMLElement;
    expect(meta.querySelector('.assignee-label')?.getAttribute('aria-label')).toBe('AI');
    expect(meta.querySelector('.detail__assignee')?.textContent).toBe('AI');
    expect(meta.querySelector('.detail__assignee')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the shared Button for Delete and Cancel in the confirmation', async () => {
    renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(8)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archive task' }));
    const group = screen.getByRole('group', { name: /^Archive #8/ });
    expect(
      within(group).getByRole('button', { name: 'Archive' }).getAttribute('data-variant'),
    ).toBe('destructive');
    expect(within(group).getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBe(
      'outline',
    );
  });

  it('uses neutral dots for duplicate notes even when their text mentions statuses or actors', async () => {
    const at = '2026-10-01T16:00:00Z';
    const task = makeTask({
      id: 33,
      history: [
        { at, reason: 'AI checked Pending work.' },
        { at, reason: 'AI checked Pending work.' },
        { at, reason: 'Work completed after review.' },
      ],
    });
    const { container } = renderDetail(
      <DetailPanel projectId={PROJECT_A.id} task={task} onClose={noop} onRemove={noRemove} />,
    );
    await openHistory();
    expect(
      [...container.querySelectorAll('.history__step .dot')].map((dot) =>
        dot.getAttribute('data-tone'),
      ),
    ).toEqual(['idle', 'idle', 'idle']);
    expect(container.querySelectorAll('.history__reason')).toHaveLength(3);
  });
});

it('shows every attachment after the description and only offers viewing controls', async () => {
  selectLocale('en');
  const attachment = {
    id: '0123456789abcdef0123456789abcdef',
    name: 'unreferenced.png',
    mediaType: 'image/png',
    size: 50,
    createdAt: '2026-10-08T00:00:00Z',
  };
  const { container } = renderDetail(
    <DetailPanel
      projectId={PROJECT_A.id}
      task={makeTask({
        id: 1,
        description: 'Text without an image reference',
        attachments: [attachment],
      })}
      onClose={noop}
      onRemove={noRemove}
    />,
  );
  const list = await screen.findByRole('region', { name: 'Image attachments' });
  expect(list.textContent).toContain('Attachments · 1');
  expect(list.textContent).toContain('unreferenced.png');
  expect(
    container.querySelector('.detail__viewport > .detail-attachments:last-child'),
  ).not.toBeNull();
  expect(within(list).getAllByRole('button')).toHaveLength(1);
  await userEvent.click(within(list).getByRole('button', { name: 'Preview unreferenced.png' }));
  const zoom = screen.getByRole('dialog', { name: 'unreferenced.png' });
  expect(within(zoom).getByRole('img').getAttribute('src')).toContain(
    `/api/projects/${PROJECT_A.id}/tasks/`,
  );
  await userEvent.click(within(zoom).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
