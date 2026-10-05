import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionDialog, type DialogAction } from '../../src/components/ActionDialog';
import { selectLocale } from '../../src/i18n';
import { fixtureCard } from '../fixtures';

type Data = Parameters<React.ComponentProps<typeof ActionDialog>['onSubmit']>[0];

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

describe('create dialog', () => {
  it('shows the form with the fixed destination and the assignee choice', async () => {
    const { dialog } = await openHost({ kind: 'create' }, async () => undefined);
    expect(within(dialog).getByRole('heading', { name: 'Add a card' })).toBeTruthy();
    expect(within(dialog).getByLabelText(/^Title/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/^Description/)).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Agent' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(dialog).getByRole('radio', { name: 'User' })).toBeTruthy();
    expect(within(dialog).getByText('Todo')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Create card' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('submits the trimmed title, description and chosen assignee, then closes', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openHost({ kind: 'create' }, onSubmit);
    await userEvent.type(within(dialog).getByLabelText(/^Title/), '  Review notes  ');
    await userEvent.type(within(dialog).getByLabelText(/^Description/), 'Line 1\nLine 2');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'User' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create card' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      title: 'Review notes',
      description: 'Line 1\nLine 2',
      assignee: 'human',
    });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('rejects an empty and an over-long title without calling the API', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openHost({ kind: 'create' }, onSubmit);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create card' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Enter a title.');
    const title = within(dialog).getByLabelText(/^Title/) as HTMLInputElement;
    expect(title.maxLength).toBe(100);
    await userEvent.type(title, 'あ'.repeat(100));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create card' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

describe('saving state', () => {
  it('blocks double submit, cancel, close, Escape and outside clicks while saving', async () => {
    const pending = deferred();
    const onSubmit = vi.fn((_data: Data) => pending.promise);
    const { dialog, onClosed } = await openHost({ kind: 'create' }, onSubmit);
    const title = within(dialog).getByLabelText(/^Title/);
    await userEvent.type(title, 'Slow save');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create card' }));

    const saving = within(dialog).getByRole('button', { name: 'Saving…' });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await userEvent.click(saving);
    await userEvent.type(title, '{Enter}');
    await userEvent.keyboard('{Escape}');
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    await userEvent.click(overlay as Element);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    await act(async () => pending.resolve());
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('keeps the input and the dialog on failure, shows an alert, and allows a retry', async () => {
    const first = deferred();
    const onSubmit = vi
      .fn<(data: Data) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(undefined);
    const { dialog, onClosed } = await openHost({ kind: 'create' }, onSubmit);
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Keep me');
    await userEvent.type(within(dialog).getByLabelText(/^Description/), 'Body text');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'User' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create card' }));
    await act(async () => first.reject(new Error('The server said no.')));

    expect((await within(dialog).findByRole('alert')).textContent).toBe('The server said no.');
    expect(onClosed).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Keep me');
    expect((within(dialog).getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe(
      'Body text',
    );
    expect(within(dialog).getByRole('radio', { name: 'User' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    const save = within(dialog).getByRole('button', { name: 'Create card' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(
      (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await userEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({ title: 'Keep me', assignee: 'human' });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('uses the generic message when the failure is not an Error', async () => {
    const onSubmit = vi.fn(async (_data: Data) => {
      throw 'nope';
    });
    const { dialog } = await openHost({ kind: 'create' }, onSubmit);
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create card' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Could not save the change.',
    );
  });
});

describe('closing and focus', () => {
  it('closes with Escape, the close button and Cancel, and returns focus to the opener', async () => {
    for (const how of ['escape', 'close', 'cancel'] as const) {
      const { opener, onClosed, dialog } = await openHost(
        { kind: 'create' },
        async () => undefined,
      );
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      if (how === 'escape') await userEvent.keyboard('{Escape}');
      else if (how === 'close')
        await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      else await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
      cleanup();
    }
  });

  it('keeps Tab inside the dialog', async () => {
    const { dialog } = await openHost({ kind: 'create' }, async () => undefined);
    for (let step = 0; step < 12; step++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('does not close on an outside click when idle (typed input is not discarded by accident)', async () => {
    const { dialog, onClosed } = await openHost({ kind: 'create' }, async () => undefined);
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'draft');
    await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]') as Element);
    expect(onClosed).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('draft');
  });

  it('returns focus to the source card when there is no opener (drag move)', async () => {
    const card = fixtureCard(14);
    function DragHost() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" className="card">
            <span className="card__id">#{card.id}</span>
            <span>{card.title}</span>
          </button>
          {open && (
            <ActionDialog
              action={{ kind: 'move', card, target: 'doing' }}
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
      screen.getByRole('button', { name: new RegExp(`^#${card.id}`) }),
    );
  });
});

describe('move dialog', () => {
  it('shows the card, the current column to the target column, and requires a reason', async () => {
    const card = fixtureCard(14);
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openHost({ kind: 'move', card, target: 'doing' }, onSubmit);
    expect(within(dialog).getByText(`#${card.id} ${card.title}`)).toBeTruthy();
    const transition = within(dialog).getByRole('group', { name: 'Status change' });
    expect(transition.textContent).toMatch(/Todo.*Doing/);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Enter a reason up to 2,000 characters.',
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Ready to start');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ reason: 'Ready to start' });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });
});

describe('answer dialog', () => {
  it('shows the run state change from the current state to Idle, as in the design', async () => {
    const card = fixtureCard(12);
    const { dialog } = await openHost({ kind: 'answer', card }, async () => undefined);
    const group = within(dialog).getByRole('group', { name: 'Status change' });
    expect(group.textContent).toMatch(/Pending.*Idle/);
    expect(within(group).queryByText('Doing')).toBeNull();
    expect(within(group).queryByRole('img')).toBeNull();
    expect(group.querySelector('svg.lucide-arrow-right')).not.toBeNull();
    expect(group.querySelector('svg.lucide-pause')).not.toBeNull();
  });

  it('shows the pending request and submits the answer', async () => {
    const card = fixtureCard(12);
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openHost({ kind: 'answer', card }, onSubmit);
    expect(within(dialog).getByRole('heading', { name: 'Answer request' })).toBeTruthy();
    expect(within(dialog).getByText(card.pendingReason as string)).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText(/^Answer and direction/), 'Keep it.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send answer' }));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ reason: 'Keep it.' });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });
});
