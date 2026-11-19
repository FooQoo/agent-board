import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionDialog, type DialogAction } from '../../src/app/dialogs/ActionDialog';
import { selectLocale } from '../../src/shared/i18n';
import { fixtureTask } from '../fixtures';

vi.mock(
  '../../src/shared/rich-editor/RichMarkdownEditor',
  () => import('../editor/fakeRichEditor'),
);

type Data = Parameters<React.ComponentProps<typeof ActionDialog>['onSubmit']>[0];

function Host({
  action,
  onSubmit,
  onClosed,
}: {
  action: DialogAction;
  onSubmit: (data: Data) => Promise<void>;
  onClosed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open action
      </button>
      {open && (
        <ActionDialog
          action={action}
          onSubmit={onSubmit}
          onClose={() => {
            setOpen(false);
            onClosed?.();
          }}
        />
      )}
    </>
  );
}

async function openHost(action: DialogAction, onSubmit: (data: Data) => Promise<void>) {
  const onClosed = vi.fn();
  render(<Host action={action} onSubmit={onSubmit} onClosed={onClosed} />);
  const opener = screen.getByRole('button', { name: 'Open action' });
  await userEvent.click(opener);
  return { opener, onClosed, dialog: screen.getByRole('dialog') };
}

beforeEach(() => selectLocale('en'));
afterEach(() => {
  cleanup();
  selectLocale('en');
  window.localStorage.clear();
});

describe('closing and focus', () => {
  it('closes with Escape, and the close button, and returns focus to the opener', async () => {
    for (const how of ['escape', 'close'] as const) {
      const { opener, onClosed, dialog } = await openHost(
        { kind: 'request' },
        async () => undefined,
      );
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      if (how === 'escape') await userEvent.keyboard('{Escape}');
      else await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
      cleanup();
    }
  });

  it('keeps Tab inside the dialog', async () => {
    const { dialog } = await openHost({ kind: 'request' }, async () => undefined);
    for (let step = 0; step < 12; step++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('returns focus to the source task when there is no opener (drag move)', async () => {
    const task = fixtureTask(14);
    function DragHost() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" className="card">
            <span className="card__id">#{task.id}</span>
            <span>{task.title}</span>
          </button>
          {open && (
            <ActionDialog
              action={{ kind: 'move', task, target: 'doing' }}
              onSubmit={async () => undefined}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    render(<DragHost />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: new RegExp(`^#${task.id}`) }),
    );
  });
});

describe('move dialog', () => {
  it('opens with the sentence of the move in the current language, and submits what is in the field', async () => {
    selectLocale('ja');
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog } = await openHost(
      { kind: 'move', task: fixtureTask(14), target: 'done' },
      onSubmit,
    );
    const reason = within(dialog).getByLabelText(/^変更理由/) as HTMLTextAreaElement;
    expect(reason.value).toBe('');
    await userEvent.click(within(dialog).getByRole('button', { name: '移動する' }));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      reason: 'ユーザーが未着手から完了に変更しました。',
    });
  });

  it('shows the transition and submits a localized default when the reason is blank', async () => {
    const task = fixtureTask(14);
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openHost({ kind: 'move', task, target: 'doing' }, onSubmit);
    expect(within(dialog).getByText(`#${task.id} ${task.title}`)).toBeTruthy();
    const transition = within(dialog).getByRole('group', { name: 'Status change' });
    expect(transition.textContent).toMatch(/Todo.*Doing/);

    const reason = within(dialog).getByLabelText(/^Reason/) as HTMLTextAreaElement;
    expect(reason.value).toBe('');
    await userEvent.clear(reason);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      fromStatus: 'todo',
      reason: 'User changed the status from Todo to Doing.',
    });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });
});

it('generates the move reason from the latest task state and language at confirmation', async () => {
  const onSubmit = vi.fn(async (_data: Data) => undefined);
  const task = fixtureTask(14);
  const { rerender } = render(
    <ActionDialog
      action={{ kind: 'move', task, target: 'doing' }}
      onClose={() => undefined}
      onSubmit={onSubmit}
    />,
  );
  const reason = screen.getByRole('textbox', { name: /^Reason/ });
  await userEvent.type(reason, '   ');
  selectLocale('ja');
  rerender(
    <ActionDialog
      action={{ kind: 'move', task: { ...task, taskStatus: 'done' }, target: 'todo' }}
      onClose={() => undefined}
      onSubmit={onSubmit}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: '移動する' }));
  expect(onSubmit).toHaveBeenCalledWith({
    fromStatus: 'done',
    reason: 'ユーザーが完了から未着手に変更しました。',
  });
});

it('keeps an explicit move reason exactly as written', async () => {
  const onSubmit = vi.fn(async (_data: Data) => undefined);
  const { dialog } = await openHost(
    { kind: 'move', task: fixtureTask(14), target: 'doing' },
    onSubmit,
  );
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: /^Reason/ }),
    '  Ready to start\nAfter review.  ',
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
  expect(onSubmit).toHaveBeenCalledWith({
    fromStatus: 'todo',
    reason: '  Ready to start\nAfter review.  ',
  });
});

it('uses the refreshed task lane instead of the snapshot saved when the dialog opened', async () => {
  const onSubmit = vi.fn(async (_data: Data) => undefined);
  const task = fixtureTask(14);
  const action = { kind: 'move' as const, task, target: 'doing' as const };
  const { rerender } = render(
    <ActionDialog action={action} onClose={() => undefined} onSubmit={onSubmit} tasks={[task]} />,
  );
  rerender(
    <ActionDialog
      action={action}
      onClose={() => undefined}
      onSubmit={onSubmit}
      tasks={[{ ...task, taskStatus: 'done' }]}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Move' }));
  expect(onSubmit).toHaveBeenCalledWith({
    fromStatus: 'done',
    reason: 'User changed the status from Done to Doing.',
  });
});

describe('opening on a touch screen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the focus on the dialog so the software keyboard stays down', async () => {
    const real = window.matchMedia;
    vi.stubGlobal('matchMedia', (media: string) => ({
      ...real(media),
      matches: media === '(pointer: coarse)',
    }));
    const { dialog } = await openHost({ kind: 'request' }, async () => undefined);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const active = document.activeElement;
    expect(active).toBe(dialog);
    expect(active?.matches('input, textarea, [contenteditable="true"]')).toBe(false);
  });
});
