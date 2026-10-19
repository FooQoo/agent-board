import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCard } from '../../src/features/tasks/card/TaskCard';
import { DetailPanel } from '../../src/features/tasks/detail/DetailPanel';
import { selectLocale } from '../../src/shared/i18n';
import type { Task as TaskModel } from '../../src/shared/api/contracts';
import { deferred, jsonResponse } from '../fakes';
import { PROJECT_A, fixtureTask } from '../fixtures';

const noop = () => {};
const noRemove = async () => true;

function renderPanel(task: TaskModel, onChanged = vi.fn()) {
  render(
    <DetailPanel
      projectId={PROJECT_A.id}
      task={task}
      onClose={noop}
      onRemove={noRemove}
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

const draftOf = (task: TaskModel): TaskModel => ({ ...task, isDraft: true });

beforeEach(() => {
  selectLocale('en');
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  selectLocale('en');
});

describe('draft banner', () => {
  it('is not shown for a task that is not a draft', () => {
    renderPanel(fixtureTask(8));
    expect(screen.queryByRole('button', { name: 'Finalize' })).toBeNull();
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('says Draft, that agents only read, and offers Finalize', () => {
    renderPanel(draftOf(fixtureTask(8)));
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText(/read/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Finalize' })).toBeTruthy();
  });

  it('is written in Japanese', () => {
    selectLocale('ja');
    renderPanel(draftOf(fixtureTask(8)));
    expect(screen.getByText('下書き')).toBeTruthy();
    expect(screen.getByText('AIは読み取り専用です。確定すると、AIが扱えます。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '確定する' })).toBeTruthy();
  });
});

describe('Make draft and Finalize', () => {
  it('Make draft sends PUT draft true and reports the change', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ task: fixtureTask(8) }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = renderPanel(fixtureTask(8));
    await userEvent.click(screen.getByRole('button', { name: 'Make draft' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT_A.id}/tasks/8/draft`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ isDraft: true });
  });

  it('Finalize sends PUT draft false and reports the change', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ task: fixtureTask(8) }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = renderPanel(draftOf(fixtureTask(8)));
    await userEvent.click(screen.getByRole('button', { name: 'Finalize' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ isDraft: false });
  });

  it('shows an error near the button and changes nothing when Make draft fails (409)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'invalid_state_for_draft', message: 'x', reason: 'y' } },
          409,
        ),
      ),
    );
    const onChanged = renderPanel(fixtureTask(8));
    await userEvent.click(screen.getByRole('button', { name: 'Make draft' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.');
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Make draft' })).toBeTruthy();
  });

  it('shows the error in the banner when Finalize fails on the network, and can try again', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('down'))
      .mockResolvedValueOnce(jsonResponse({ task: fixtureTask(8) }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = renderPanel(draftOf(fixtureTask(8)));
    await userEvent.click(screen.getByRole('button', { name: 'Finalize' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.');
    expect(onChanged).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Finalize' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses a second press while the first one is saving', async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    renderPanel(fixtureTask(8));
    const button = screen.getByRole('button', { name: 'Make draft' });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    gate.resolve(jsonResponse({ task: fixtureTask(8) }));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it('keeps Make draft in the toolbar on every tab', async () => {
    renderPanel(fixtureTask(8));
    for (const name of [/^History/, /^Conditions/, /^Epic/]) {
      await userEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('button', { name: 'Make draft' })).toBeTruthy();
    }
  });

  it('Make draft is Japanese: 下書きにする', () => {
    selectLocale('ja');
    renderPanel(fixtureTask(8));
    expect(screen.getByRole('button', { name: '下書きにする' })).toBeTruthy();
  });
});

describe('draft chip on the tile', () => {
  it('shows Draft next to the id and the assignee only for a draft', () => {
    const { container, rerender } = render(
      <TaskCard task={fixtureTask(14)} selected={false} onSelect={noop} />,
    );
    expect(container.querySelector('.card__draft')).toBeNull();
    rerender(<TaskCard task={draftOf(fixtureTask(14))} selected={false} onSelect={noop} />);
    const chip = container.querySelector('.card__draft');
    expect(chip?.textContent).toBe('Draft');
    const top = container.querySelector('.card__top') as HTMLElement;
    const kinds = Array.from(top.children).map((el) =>
      el.classList.contains('card__id')
        ? 'id'
        : el.classList.contains('assignee-label')
          ? 'assignee'
          : el.classList.contains('card__draft')
            ? 'draft'
            : 'other',
    );
    expect(kinds.slice(1, 4)).toEqual(['id', 'assignee', 'draft']);
  });

  it('says 下書き in Japanese', () => {
    selectLocale('ja');
    render(<TaskCard task={draftOf(fixtureTask(14))} selected={false} onSelect={noop} />);
    expect(screen.getByText('下書き')).toBeTruthy();
  });
});
