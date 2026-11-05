import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTask } from '../.storybook/support/fixtures';
import { EditDialog, type EditDialogProps } from '../src/features/tasks/editor/EditDialog';
import { selectLocale } from '../src/shared/i18n';
import { WriteError } from '../src/shared/api/writeErrors';
import type { Task } from '../src/shared/api/contracts';
import type { ChangeSubscription } from '../src/shared/ui/editor/useFollowLatest';

beforeEach(() => selectLocale('en'));
afterEach(() => {
  cleanup();
  selectLocale('en');
});

const BODY = '## Background\n\nRead this.\n\n## Steps\n\nDo it.\n';
const attachment = {
  id: 'a1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 10,
  createdAt: '2026-11-05T00:00:00Z',
};

const base = (overrides: Partial<Task> = {}) =>
  makeTask({
    id: 14,
    title: 'Original title',
    description: BODY,
    body: BODY,
    acceptance: [{ id: 'AC-1', text: 'Keep it', done: false }],
    ...overrides,
  });

function setup(props: Partial<EditDialogProps> & { task?: Task } = {}) {
  const task = props.task ?? base();
  const onClose = vi.fn();
  const onSubmit = vi.fn(async () => {});
  const enterDraft = vi.fn(async () => task);
  const leaveDraft = vi.fn(async () => {});
  render(
    <EditDialog
      task={task}
      renderEpicChip={() => null}
      onClose={onClose}
      onSubmit={onSubmit}
      enterDraft={enterDraft}
      leaveDraft={leaveDraft}
      {...props}
    />,
  );
  return { task, onClose, onSubmit, enterDraft, leaveDraft, user: userEvent.setup() };
}

const titleInput = () => screen.getByRole('textbox', { name: 'Title' });
const save = () => screen.getByRole('button', { name: 'Save' });
const footer = () => document.querySelector<HTMLElement>('.editor__footer') as HTMLElement;

describe('task preview', () => {
  it('reads without entering a draft', () => {
    const { enterDraft } = setup();
    expect(screen.getByRole('dialog', { name: /Task preview/ })).toBeTruthy();
    expect(screen.queryByText('Draft')).toBeNull();
    expect(save().hasAttribute('disabled')).toBe(true);
    expect(within(footer()).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(enterDraft).not.toHaveBeenCalled();
  });

  it('enters a draft at the first change and shows the lock', async () => {
    const { user, enterDraft } = setup();
    await user.type(titleInput(), '!');
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false));
    expect(enterDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText(/Agents can't change this task until you save/)).toBeTruthy();
    expect(within(footer()).getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('saves in one last request that also ends the draft this dialog made', async () => {
    const { user, onSubmit, onClose, leaveDraft } = setup();
    await user.type(titleInput(), '!');
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false));
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ title: 'Original title!', finalize: true });
    expect(leaveDraft).not.toHaveBeenCalled();
  });

  it('keeps a card that was a draft before opening as a draft', async () => {
    const { user, onSubmit, onClose, enterDraft } = setup({ task: base({ isDraft: true }) });
    expect(screen.getByText('Draft')).toBeTruthy();
    await user.type(titleInput(), '!');
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(enterDraft).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith({ title: 'Original title!' });
  });

  it('sends images first, then the last request; a failure resends only the rest', async () => {
    const task = base({ attachments: [attachment] });
    const onSubmit = vi
      .fn<(data: unknown) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new WriteError('down', 503, null))
      .mockResolvedValue(undefined);
    const { user, onClose, leaveDraft } = setup({ task, onSubmit });
    await user.click(screen.getByRole('button', { name: 'Remove shot.png' }));
    await user.type(titleInput(), '!');
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false));
    await user.click(save());
    await screen.findByRole('alert');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ removedAttachmentIds: ['a1'] });
    expect(onSubmit.mock.calls[1]?.[0]).toEqual({ title: 'Original title!', finalize: true });
    expect((titleInput() as HTMLInputElement).value).toBe('Original title!');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(3);
    expect(onSubmit.mock.calls[2]?.[0]).toEqual({ title: 'Original title!', finalize: true });
    expect(leaveDraft).not.toHaveBeenCalled();
  });

  it('can retry the last request when only images changed and that request failed', async () => {
    const task = base({ attachments: [attachment] });
    const onSubmit = vi
      .fn<(data: unknown) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new WriteError('down', 503, null))
      .mockResolvedValue(undefined);
    const { user, onClose } = setup({ task, onSubmit });
    await user.click(screen.getByRole('button', { name: 'Remove shot.png' }));
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false));
    await user.click(save());
    await screen.findByRole('alert');
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]?.[0]).toEqual({ finalize: true });
    expect(save().hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(3);
    expect(onSubmit.mock.calls[2]?.[0]).toEqual({ finalize: true });
  });

  it('takes the draft back when the changes are discarded', async () => {
    const { user, onClose, leaveDraft, onSubmit } = setup();
    await user.type(titleInput(), '!');
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false));
    await user.click(within(footer()).getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard and close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(leaveDraft).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not take back a draft that was there before opening', async () => {
    const { user, onClose, leaveDraft } = setup({ task: base({ isDraft: true }) });
    await user.type(titleInput(), '!');
    await user.click(within(footer()).getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard and close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(leaveDraft).not.toHaveBeenCalled();
  });
});

describe('task preview states', () => {
  it('opens a running task read-only, with the chip and the reason, and still moves by outline', async () => {
    const { user, enterDraft } = setup({ readOnlyReason: 'running' });
    const dialog = screen.getByRole('dialog');
    expect(dialog.hasAttribute('data-read-only')).toBe(true);
    expect(within(dialog).getAllByText('Running').length).toBeGreaterThan(0);
    expect(screen.getByText('Read-only while an agent is working.')).toBeTruthy();
    expect(titleInput().hasAttribute('disabled')).toBe(true);
    expect(save().hasAttribute('disabled')).toBe(true);
    const outline = screen.getByRole('navigation', { name: 'Outline' });
    const item = within(outline).getByRole('button', { name: /Steps/ });
    expect(item.hasAttribute('disabled')).toBe(false);
    await user.click(item);
    expect(enterDraft).not.toHaveBeenCalled();
  });

  it('opens an archived task read-only with its reason', () => {
    setup({ readOnlyReason: 'archived' });
    expect(screen.getByRole('dialog').hasAttribute('data-read-only')).toBe(true);
    expect(screen.getByText('Read-only because it is archived.')).toBeTruthy();
    expect(screen.queryByText('Running')).toBeNull();
  });

  it('keeps the input and stops saving when the task started running at the first change', async () => {
    const enterDraft = vi.fn(async () => {
      throw new WriteError('running', 409, 'invalid_state_for_draft');
    });
    const { user } = setup({ enterDraft });
    await user.type(titleInput(), '!');
    await screen.findByText("An agent started working on this task, so it can't be saved.");
    expect((titleInput() as HTMLInputElement).value).toBe('Original title!');
    expect(save().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('You have unsaved changes.')).toBeTruthy();
  });

  it('shows the error band with Retry when the draft could not be entered', async () => {
    const enterDraft = vi
      .fn<() => Promise<Task>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(base());
    const { user } = setup({ enterDraft });
    await user.type(titleInput(), '!');
    await screen.findByRole('alert');
    expect(save().hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false));
    expect(enterDraft).toHaveBeenCalledTimes(2);
  });

  it('stops saving on a conflict, with the error and the unsaved notice, and keeps the input', async () => {
    const enterDraft = vi.fn(async () => base({ title: 'Changed by an agent' }));
    const { user } = setup({ enterDraft });
    await user.type(titleInput(), '!');
    await screen.findByText("An agent changed this task while it was open, so it can't be saved.");
    expect(screen.getByText(/Agents can't change this task until you save/)).toBeTruthy();
    expect(save().hasAttribute('disabled')).toBe(true);
    expect((titleInput() as HTMLInputElement).value).toBe('Original title!');
  });

  it('does not treat a change of state or dates alone as a conflict', async () => {
    const enterDraft = vi.fn(async () =>
      base({ updatedAt: '2030-01-01T00:00:00Z', agentStatus: 'running', isDraft: true }),
    );
    const { user } = setup({ enterDraft });
    await user.type(titleInput(), '!');
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false));
    expect(screen.queryByText(/while it was open/)).toBeNull();
  });
});

describe('task preview following', () => {
  function follow() {
    const listeners = new Set<() => void>();
    const subscribeChanges: ChangeSubscription = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    return {
      subscribeChanges,
      notify: () => {
        for (const listener of [...listeners]) listener();
      },
    };
  }

  it('follows the latest while nothing was typed and shows when it updated', async () => {
    const { subscribeChanges, notify } = follow();
    const reload = vi.fn(async () => base({ title: 'Edited elsewhere' }));
    setup({ subscribeChanges, reload });
    notify();
    await waitFor(() => expect((titleInput() as HTMLInputElement).value).toBe('Edited elsewhere'));
    expect(within(footer()).getByText(/^Updated at /)).toBeTruthy();
  });

  it('does not rebuild or show an update time when the content did not change', async () => {
    const { subscribeChanges, notify } = follow();
    const reload = vi.fn(async () => base({ updatedAt: '2031-01-01T00:00:00Z' }));
    setup({ subscribeChanges, reload });
    notify();
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(within(footer()).getByText('No changes')).toBeTruthy();
  });

  it('stops following at the first change', async () => {
    const { subscribeChanges, notify } = follow();
    const reload = vi.fn(async () => base({ title: 'Edited elsewhere' }));
    const { user } = setup({ subscribeChanges, reload });
    await user.type(titleInput(), '!');
    notify();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reload).not.toHaveBeenCalled();
    expect((titleInput() as HTMLInputElement).value).toBe('Original title!');
  });
});
