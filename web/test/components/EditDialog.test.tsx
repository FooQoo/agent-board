import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteError, editCard } from '../../src/api';
import { ActionDialog } from '../../src/components/ActionDialog';
import { selectLocale } from '../../src/i18n';
import { editorSpy } from '../editor/fakeRichEditor';
import { makeCard } from '../fixtures';

vi.mock('../../src/components/editor/RichMarkdownEditor', () => import('../editor/fakeRichEditor'));

type Data = Parameters<React.ComponentProps<typeof ActionDialog>['onSubmit']>[0];

const DRAFT = makeCard({
  id: 14,
  title: 'CLI target selection',
  description: '## Goal\n\nExplain the target.\n\n## Done when\n\n- [ ] AC-1',
  isDraft: true,
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openEdit(
  onSubmit: (data: Data) => Promise<void> = async () => undefined,
  card = DRAFT,
) {
  const onClosed = vi.fn();
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open editor
        </button>
        {open && (
          <ActionDialog
            action={{ kind: 'edit', card }}
            onSubmit={onSubmit}
            onClose={() => {
              setOpen(false);
              onClosed();
            }}
          />
        )}
      </>
    );
  }
  render(<Host />);
  const opener = screen.getByRole('button', { name: 'Open editor' });
  await userEvent.click(opener);
  return {
    opener,
    onClosed,
    dialog: screen.getByRole('dialog', { name: new RegExp(`#${card.id}`) }),
  };
}

describe('epic row', () => {
  it('sits in the right column above the images panel, not above the title', async () => {
    const card = makeCard({
      id: 15,
      title: 'Labeled draft',
      isDraft: true,
      epic: { id: 'SHARED-FILES', name: 'Shared files', color: '#7C3AED' },
    });
    const { dialog } = await openEdit(async () => undefined, card);
    const chip = within(dialog).getByText('SHARED-FILES');
    const row = chip.closest('.editor__epic-row') as HTMLElement;
    expect(row).not.toBeNull();
    const aside = row.parentElement as HTMLElement;
    expect(aside.classList.contains('editor__aside')).toBe(true);
    const panel = within(aside).getByRole('region', { name: /Image attachments|添付画像/ });
    expect(row.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dialog.querySelector('.editor__main')?.contains(row)).toBe(false);
    const main = dialog.querySelector('.editor__main') as HTMLElement;
    expect((main.firstElementChild as HTMLElement).querySelector('input')).not.toBeNull();
  });

  it('is absent for a card without an epic', async () => {
    const { dialog } = await openEdit();
    expect(dialog.querySelector('.editor__epic-row')).toBeNull();
  });
});

const button = (root: HTMLElement, name: string) =>
  within(root).getByRole('button', { name }) as HTMLButtonElement;

const bodyOf = (root: HTMLElement) =>
  within(root).getByRole('textbox', { name: /Markdown/ }) as HTMLTextAreaElement;

const descriptionOf = (root: HTMLElement) => bodyOf(root).value;

function setDescription(text: string, root: HTMLElement) {
  fireEvent.change(bodyOf(root), { target: { value: text } });
}

function setTitle(text: string, root: HTMLElement) {
  fireEvent.change(within(root).getByLabelText('Title'), { target: { value: text } });
}

beforeEach(() => {
  selectLocale('en');
  editorSpy.goTo.mockClear();
  editorSpy.insert.mockClear();
});
afterEach(() => {
  cleanup();
  selectLocale('en');
  window.localStorage.clear();
});

describe('edit dialog layout', () => {
  it('shows the header, the outline, the fields, the draft box and one Cancel and Save pair', async () => {
    const { dialog } = await openEdit();
    expect(within(dialog).getByText('#14')).toBeTruthy();
    expect(within(dialog).getByText('Edit card')).toBeTruthy();
    // The draft state is not edited here: no badge and no draft box.
    expect(dialog.querySelector('.editor__badge')?.textContent ?? '').toBe('');
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).value).toBe(
      'CLI target selection',
    );
    expect(descriptionOf(dialog)).toBe(DRAFT.description);
    const outline = within(dialog).getByRole('navigation', { name: 'Outline' });
    expect(
      within(outline)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['01Goal', '02Done when']);
    expect(within(dialog).queryByRole('tab')).toBeNull();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(button(dialog, 'Cancel')).toBeTruthy();
    expect(button(dialog, 'Save')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Save and finalize' })).toBeNull();
    expect(within(dialog).getByRole('region', { name: 'Image attachments' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Close attachments panel' })).toBeNull();
  });

  it('shows the Japanese wording', async () => {
    selectLocale('ja');
    const { dialog } = await openEdit();
    expect(within(dialog).getByText('カードを編集')).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    for (const name of ['キャンセル', '保存']) {
      expect(button(dialog, name)).toBeTruthy();
    }
    setDescription('x', dialog);
    expect(within(dialog).getByText('未保存の変更があります')).toBeTruthy();
  });

  it('keeps the outline in step with the text', async () => {
    const { dialog } = await openEdit();
    const outline = within(dialog).getByRole('navigation', { name: 'Outline' });
    setDescription('plain text only', dialog);
    await waitFor(() =>
      expect(outline.textContent).toContain('Add a heading (## ) and the outline appears here.'),
    );
    setDescription('## One\n\n```\n## Not a heading\n```\n\n## Two', dialog);
    await waitFor(() =>
      expect(
        within(outline)
          .getAllByRole('button')
          .map((item) => item.textContent),
      ).toEqual(['01One', '02Two']),
    );
  });

  it('marks the first chapter as current when the text starts before any chapter', async () => {
    const card = makeCard({
      id: 14,
      isDraft: true,
      description:
        'An introduction before the first chapter.\n\n## Goal\n\nText.\n\n## Done when\n\n- [ ] AC-1',
    });
    const { dialog } = await openEdit(undefined, card);
    const items = within(dialog)
      .getByRole('navigation', { name: 'Outline' })
      .querySelectorAll('.editor__outline-item');
    expect(items[0]?.getAttribute('aria-current')).toBe('location');
    expect(items[1]?.getAttribute('aria-current')).toBeNull();
  });

  it('moves to the nth second-level heading when its outline item is pressed', async () => {
    const { dialog } = await openEdit();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done when' }));
    expect(editorSpy.goTo).toHaveBeenCalledWith(1);
  });
});

describe('saving', () => {
  it('saves the body and the conditions in one request, and the done flag is kept', async () => {
    const card = makeCard({
      id: 16,
      description: '## Goal\n\nBody.',
      acceptance: [{ id: 'AC-1', text: 'Works', done: false }],
    });
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog } = await openEdit(onSubmit, card);
    // The conditions fold at the bottom of the dialog; open them to check the condition.
    await userEvent.click(within(dialog).getByRole('button', { name: /^Acceptance conditions/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Done: AC-1' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      body: '## Goal\n\nBody.',
      acceptance: [{ id: 'AC-1', text: 'Works', done: true }],
    });
  });

  it('keeps Save disabled until something changes', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog } = await openEdit(onSubmit);
    expect(button(dialog, 'Save').disabled).toBe(true);
    expect(within(dialog).queryByText('You have unsaved changes.')).toBeNull();
    setDescription('## New body', dialog);
    expect(within(dialog).getByText('You have unsaved changes.')).toBeTruthy();
    expect(button(dialog, 'Save').disabled).toBe(false);
  });

  it('closes without saving or asking when the body is opened and closed unchanged', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openEdit(onSubmit);
    await userEvent.click(button(dialog, 'Cancel'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves the body first and then the title, sending only what changed', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openEdit(onSubmit);
    setDescription('## New body', dialog);
    setTitle('  Renamed  ', dialog);
    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls).toEqual([
      [{ body: '## New body', acceptance: [] }],
      [{ title: 'Renamed' }],
    ]);
    // Saving never changes the draft state of the card.
    expect(onSubmit.mock.calls.some(([data]) => 'finalize' in data)).toBe(false);
  });

  it('sends the removed stored images first, before the body', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const card = makeCard({
      id: 14,
      isDraft: true,
      description: '## Goal\n\nBody.',
      attachments: [
        {
          id: 'a'.repeat(32),
          name: 'shot.png',
          mediaType: 'image/png',
          size: 10,
          createdAt: '2026-10-02T00:00:00Z',
        },
      ],
    });
    const { dialog, onClosed } = await openEdit(onSubmit, card);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove shot.png' }));
    setDescription('## Goal\n\nChanged.', dialog);
    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      requestId: expect.any(String),
      attachments: [],
      removedAttachmentIds: ['a'.repeat(32)],
    });
    expect(onSubmit.mock.calls[1]?.[0]).toEqual({ body: '## Goal\n\nChanged.', acceptance: [] });
  });

  it('normalizes CRLF line endings of the stored text', async () => {
    const card = makeCard({ id: 3, isDraft: true, description: 'a\r\nb' });
    const { dialog } = await openEdit(undefined, card);
    expect(descriptionOf(dialog)).toBe('a\nb');
    expect(button(dialog, 'Save').disabled).toBe(true);
  });

  it('blocks a second submit, every way of closing, and edits while saving', async () => {
    const pending = deferred();
    const onSubmit = vi.fn((_data: Data) => pending.promise);
    const { dialog, onClosed } = await openEdit(onSubmit);
    setDescription('slow', dialog);
    await userEvent.click(button(dialog, 'Save'));

    expect(button(dialog, 'Saving…').disabled).toBe(true);
    expect(button(dialog, 'Cancel').disabled).toBe(true);
    expect(button(dialog, 'Close').disabled).toBe(true);
    expect(within(dialog).getByRole('status').textContent).toBe('Saving…');
    expect(dialog.querySelector('.editor__footer')?.getAttribute('data-saving')).toBe('true');
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).disabled).toBe(true);
    expect(bodyOf(dialog).disabled).toBe(true);

    await userEvent.keyboard('{Escape}');
    await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]') as Element);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.queryByText('Discard changes?')).toBeNull();

    await act(async () => pending.resolve());
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });
});

describe('save failures', () => {
  it('keeps the input and finished steps, shows the message, and retries only what is left', async () => {
    const card = makeCard({
      id: 14,
      isDraft: true,
      description: '## Goal\n\nBody.',
      attachments: [
        {
          id: 'b'.repeat(32),
          name: 'old.png',
          mediaType: 'image/png',
          size: 10,
          createdAt: '2026-10-02T00:00:00Z',
        },
      ],
    });
    const onSubmit = vi
      .fn<(data: Data) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new WriteError('Description is too long.', 422, 'invalid_value'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const { dialog, onClosed } = await openEdit(onSubmit, card);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove old.png' }));
    setDescription('keep this', dialog);
    setTitle('kept title', dialog);
    await userEvent.click(button(dialog, 'Save'));

    const alert = await within(dialog).findByRole('alert');
    // The server's reason is not shown; the design's sentence is.
    expect(alert.textContent).toContain('Could not save. Your input is kept. Try again.');
    expect(alert.textContent).not.toContain('Description is too long.');
    expect(onClosed).not.toHaveBeenCalled();
    expect(descriptionOf(dialog)).toBe('keep this');
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).value).toBe('kept title');
    expect(button(dialog, 'Cancel').disabled).toBe(false);

    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls.map(([data]) => Object.keys(data))).toEqual([
      ['requestId', 'attachments', 'removedAttachmentIds'],
      ['body', 'acceptance'],
      ['body', 'acceptance'],
      ['title'],
    ]);
  });

  it('says the card is not a draft for a 409 card_not_draft', async () => {
    const onSubmit = vi.fn(async (_data: Data) => {
      throw new WriteError('Card #14 is not a draft.', 409, 'card_not_draft');
    });
    const { dialog } = await openEdit(onSubmit);
    setDescription('x', dialog);
    await userEvent.click(button(dialog, 'Save'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'This card is not a draft.',
    );
    expect(descriptionOf(dialog)).toBe('x');
  });

  it('shows a generic message when the server cannot be reached and labels Save as a retry', async () => {
    const onSubmit = vi.fn(async (_data: Data) => {
      throw new TypeError('Failed to fetch');
    });
    const { dialog } = await openEdit(onSubmit);
    setDescription('x', dialog);
    await userEvent.click(button(dialog, 'Save'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Could not save. Your input is kept. Try again.',
    );
    expect(button(dialog, 'Save').disabled).toBe(false);
    expect(button(dialog, 'Retry').disabled).toBe(false);
  });
});

describe('unsaved changes', () => {
  it('closes without a question when nothing changed', async () => {
    for (const how of ['cancel', 'close', 'escape', 'backdrop'] as const) {
      const { dialog, onClosed, opener } = await openEdit();
      if (how === 'cancel') await userEvent.click(button(dialog, 'Cancel'));
      else if (how === 'close') await userEvent.click(button(dialog, 'Close'));
      else if (how === 'escape') await userEvent.keyboard('{Escape}');
      else await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]') as Element);
      await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Discard changes?')).toBeNull();
      expect(document.activeElement).toBe(opener);
      cleanup();
    }
  });

  it('asks before closing with changes, and Keep editing returns to the dialog', async () => {
    for (const how of ['cancel', 'close', 'escape', 'backdrop'] as const) {
      const { dialog, onClosed } = await openEdit();
      setDescription('edited', dialog);
      if (how === 'cancel') await userEvent.click(button(dialog, 'Cancel'));
      else if (how === 'close') await userEvent.click(button(dialog, 'Close'));
      else if (how === 'escape') await userEvent.keyboard('{Escape}');
      else await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]') as Element);
      const confirm = await screen.findByRole('dialog', { name: 'Discard changes?' });
      expect(onClosed).not.toHaveBeenCalled();
      await userEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
      await waitFor(() => expect(screen.queryByText('Discard changes?')).toBeNull());
      expect(onClosed).not.toHaveBeenCalled();
      expect(descriptionOf(dialog)).toBe('edited');
      cleanup();
    }
  });

  it('closes after Discard and close', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openEdit(onSubmit);
    setDescription('edited', dialog);
    await userEvent.click(button(dialog, 'Cancel'));
    const confirm = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Discard and close' }));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('limits and the title', () => {
  it('saves 50,000 characters but not 50,001', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog } = await openEdit(onSubmit);
    setDescription('あ'.repeat(50_000), dialog);
    expect(button(dialog, 'Save').disabled).toBe(false);
    expect(dialog.querySelector('.editor__counter')?.textContent).toBe('50,000 / 50,000');
    expect(dialog.querySelector('.editor__counter')?.getAttribute('data-over')).toBeNull();

    setDescription('あ'.repeat(50_001), dialog);
    expect(button(dialog, 'Save').disabled).toBe(true);
    expect(dialog.querySelector('.editor__counter')?.textContent).toBe('50,001 / 50,000');
    expect(dialog.querySelector('.editor__counter')?.getAttribute('data-over')).toBe('true');
    expect(
      within(dialog).getByText('Over the 50,000-character limit. Remove 1 character.'),
    ).toBeTruthy();
    await userEvent.click(button(dialog, 'Save'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('counts an emoji as one character', async () => {
    const { dialog } = await openEdit();
    setDescription('😀😀', dialog);
    expect(within(dialog).getByText('2 / 50,000')).toBeTruthy();
  });

  it('cannot save with an empty or blank title', async () => {
    const { dialog } = await openEdit();
    const title = within(dialog).getByLabelText('Title') as HTMLInputElement;
    expect(title.maxLength).toBe(100);
    setTitle('', dialog);
    expect(button(dialog, 'Save').disabled).toBe(true);
    setTitle('   ', dialog);
    expect(button(dialog, 'Save').disabled).toBe(true);
    expect(title.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('focus', () => {
  it('moves the focus to the title on open and returns it to the opener on close', async () => {
    const { dialog, opener } = await openEdit();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByLabelText('Title')),
    );
    await userEvent.click(button(dialog, 'Cancel'));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('with the real API client', () => {
  const PROJECT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify(body), { status });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('patches the draft with the changed description only', async () => {
    const fetchMock = stubFetch(200, { card: DRAFT });
    const { dialog, onClosed } = await openEdit((data) =>
      editCard(PROJECT, DRAFT.id, data).then(() => undefined),
    );
    setDescription('## Body', dialog);
    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/projects/${PROJECT}/cards/14`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ body: '## Body', acceptance: [] });
  });

  it('shows the design sentence for a 422 from the server, not its reason, and keeps the dialog', async () => {
    stubFetch(422, {
      error: { code: 'invalid_value', message: 'x', reason: 'Description is 50,001 of 50,000.' },
    });
    const { dialog, onClosed } = await openEdit((data) =>
      editCard(PROJECT, DRAFT.id, data).then(() => undefined),
    );
    setDescription('x', dialog);
    await userEvent.click(button(dialog, 'Save'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Could not save. Your input is kept. Try again.',
    );
    expect(onClosed).not.toHaveBeenCalled();
  });
});
