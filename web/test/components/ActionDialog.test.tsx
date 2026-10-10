import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteError } from '../../src/api';
import { ActionDialog, type DialogAction } from '../../src/components/ActionDialog';
import { selectLocale } from '../../src/i18n';
import { fixtureCard } from '../fixtures';

vi.mock('../../src/components/editor/RichMarkdownEditor', () => import('../editor/fakeRichEditor'));

type Data = Parameters<React.ComponentProps<typeof ActionDialog>['onSubmit']>[0];

/** The body of the dialog: the rich editor's stand-in is a textarea labelled with its Markdown name. */
function bodyOf(root: HTMLElement = screen.getByRole('dialog')): HTMLTextAreaElement {
  return within(root).getByRole('textbox', { name: /Markdown/ }) as HTMLTextAreaElement;
}

function descriptionOf(root?: HTMLElement): string {
  return bodyOf(root).value;
}

function setDescription(text: string, root?: HTMLElement): void {
  fireEvent.change(bodyOf(root), { target: { value: text } });
}

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
  it('shows the add form with the AI as the default assignee', async () => {
    const { dialog } = await openHost({ kind: 'create' }, async () => undefined);
    expect(dialog.textContent).toContain('Add card');
    expect(dialog.textContent).toContain('New');
    expect(within(dialog).getByLabelText('Title')).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: 'Description (Markdown)' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'AI' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(dialog).getByRole('radio', { name: 'User' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(dialog).getByText('0 / 50,000')).toBeTruthy();
    expect(within(dialog).getByRole('navigation', { name: 'Outline' }).textContent).toContain(
      'Add a heading (## ) and the outline appears here.',
    );
  });

  it('submits the trimmed title, the description and the chosen assignee, then closes', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openHost({ kind: 'create' }, onSubmit);
    await userEvent.type(within(dialog).getByLabelText('Title'), '  Review notes  ');
    setDescription('## Goal\nLine 1\r\nLine 2');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'User' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      title: 'Review notes',
      description: '## Goal\nLine 1\nLine 2',
      assignee: 'human',
    });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('adds with an empty description and the AI by default', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog } = await openHost({ kind: 'create' }, onSubmit);
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Only a title');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      title: 'Only a title',
      description: '',
      assignee: 'ai',
    });
  });

  it('cannot add with an empty, blank or over-long title', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog } = await openHost({ kind: 'create' }, onSubmit);
    const add = within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    const title = within(dialog).getByLabelText('Title') as HTMLInputElement;
    expect(add.disabled).toBe(true);
    await userEvent.type(title, '   ');
    expect(add.disabled).toBe(true);
    expect(title.maxLength).toBe(100);
    await userEvent.clear(title);
    await userEvent.type(title, 'あ'.repeat(100));
    expect(add.disabled).toBe(false);
    await userEvent.click(add);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('cannot add above 50,000 characters and shows the count in red', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog } = await openHost({ kind: 'create' }, onSubmit);
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Long');
    setDescription('a'.repeat(50_000));
    const add = within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    expect(within(dialog).getByText('50,000 / 50,000').getAttribute('data-over')).toBeNull();
    setDescription('a'.repeat(50_001));
    expect(add.disabled).toBe(true);
    expect(within(dialog).getByText('50,001 / 50,000').getAttribute('data-over')).toBe('true');
    expect(
      within(dialog).getByText('Over the 50,000-character limit. Remove 1 character.'),
    ).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('saving state', () => {
  it('blocks double submit, cancel, close, Escape and outside clicks while saving', async () => {
    const pending = deferred();
    const onSubmit = vi.fn((_data: Data) => pending.promise);
    const { dialog, onClosed } = await openHost({ kind: 'create' }, onSubmit);
    const title = within(dialog).getByLabelText('Title');
    await userEvent.type(title, 'Slow save');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    const saving = within(dialog).getByRole('button', { name: 'Saving…' });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((title as HTMLInputElement).disabled).toBe(true);
    expect(bodyOf(dialog).disabled).toBe(true);

    await userEvent.click(saving);
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
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Keep me');
    setDescription('Body text');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'User' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await act(async () => first.reject(new WriteError('The server said no.', 503, 'busy')));

    expect((await within(dialog).findByRole('alert')).textContent).toContain('The server said no.');
    expect(onClosed).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).value).toBe('Keep me');
    expect(descriptionOf()).toBe('Body text');
    expect(within(dialog).getByRole('radio', { name: 'User' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    const add = within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    expect(
      (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await userEvent.click(add);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({ title: 'Keep me', assignee: 'human' });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('uses the generic message when the failure is not a server answer', async () => {
    const onSubmit = vi.fn(async (_data: Data) => {
      throw new TypeError('Failed to fetch');
    });
    const { dialog } = await openHost({ kind: 'create' }, onSubmit);
    await userEvent.type(within(dialog).getByLabelText('Title'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Could not save. Your input is kept. Try again.',
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
    await userEvent.type(within(dialog).getByLabelText('Title'), 'draft');
    await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]') as Element);
    expect(onClosed).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).value).toBe('draft');
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
