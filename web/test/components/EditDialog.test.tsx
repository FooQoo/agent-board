import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteError, editCard } from '../../src/api';
import { ActionDialog } from '../../src/components/ActionDialog';
import { selectLocale } from '../../src/i18n';
import { descriptionOf, setDescription, viewIn } from '../editor/helpers';
import { makeCard } from '../fixtures';

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

const button = (root: HTMLElement, name: string) =>
  within(root).getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => selectLocale('en'));
afterEach(() => {
  cleanup();
  selectLocale('en');
  window.localStorage.clear();
});

describe('edit dialog layout', () => {
  it('shows the header, the outline, the fields, the counter and the footer buttons', async () => {
    const { dialog } = await openEdit();
    expect(within(dialog).getByText('#14')).toBeTruthy();
    expect(within(dialog).getByText('CLI target selection')).toBeTruthy();
    expect(within(dialog).getByText('Editing draft')).toBeTruthy();
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).value).toBe(
      'CLI target selection',
    );
    expect(descriptionOf(dialog)).toBe(DRAFT.description);
    const outline = within(dialog).getByRole('navigation', { name: 'Outline' });
    expect(
      within(outline)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['Goal', 'Done when']);
    expect(within(dialog).getByRole('tab', { name: 'Edit' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(within(dialog).getByRole('tab', { name: 'Preview' })).toBeTruthy();
    expect(within(dialog).getByText(`${DRAFT.description.length} / 50,000`)).toBeTruthy();
    for (const name of ['Cancel', 'Save', 'Save and finalize', 'Close']) {
      expect(button(dialog, name)).toBeTruthy();
    }
  });

  it('shows the Japanese wording', async () => {
    selectLocale('ja');
    const { dialog } = await openEdit();
    expect(within(dialog).getByText('下書きを編集中')).toBeTruthy();
    expect(within(dialog).getByRole('tab', { name: 'プレビュー' })).toBeTruthy();
    for (const name of ['キャンセル', '保存', '保存して確定']) {
      expect(button(dialog, name)).toBeTruthy();
    }
    setDescription('x', dialog);
    expect(within(dialog).getByText('未保存の変更があります')).toBeTruthy();
  });

  it('keeps the outline in step with the text and explains an empty outline', async () => {
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
      ).toEqual(['One', 'Two']),
    );
  });

  it('moves the cursor to a heading when its outline item is pressed', async () => {
    const { dialog } = await openEdit();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done when' }));
    expect(viewIn(dialog).state.selection.main.head).toBe(DRAFT.description.indexOf('## Done'));
  });

  it('switches to Edit when an outline item is pressed in the preview', async () => {
    const { dialog } = await openEdit();
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Preview' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done when' }));
    expect(within(dialog).getByRole('tab', { name: 'Edit' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(viewIn(dialog).state.selection.main.head).toBe(DRAFT.description.indexOf('## Done'));
  });
});

describe('edit and preview', () => {
  it('renders the same Markdown as the description tab and keeps the input across tabs', async () => {
    const { dialog } = await openEdit();
    setDescription('## Plan\n\n- [x] done item\n\nsee <b>raw</b>', dialog);
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Preview' }));
    const panel = within(dialog).getByRole('tabpanel', { name: 'Preview' });
    expect(within(panel).getByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(panel.textContent).toContain('done item');
    expect(panel.textContent).toContain('<b>raw</b>');
    expect(panel.querySelector('b')).toBeNull();
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Edit' }));
    expect(descriptionOf(dialog)).toBe('## Plan\n\n- [x] done item\n\nsee <b>raw</b>');
  });

  it('shows the empty message for an empty description in the preview', async () => {
    const { dialog } = await openEdit();
    setDescription('', dialog);
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Preview' }));
    expect(within(dialog).getByText('No description.')).toBeTruthy();
  });

  it('switches tabs with the arrow keys', async () => {
    const { dialog } = await openEdit();
    within(dialog).getByRole('tab', { name: 'Edit' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(dialog).getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('saving', () => {
  it('keeps Save disabled until something changes and sends only what changed', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog, onClosed } = await openEdit(onSubmit);
    expect(button(dialog, 'Save').disabled).toBe(true);
    expect(within(dialog).queryByText('You have unsaved changes.')).toBeNull();

    setDescription('## New body', dialog);
    expect(within(dialog).getByText('You have unsaved changes.')).toBeTruthy();
    await userEvent.click(button(dialog, 'Save'));
    expect(onSubmit.mock.calls).toEqual([[{ description: '## New body' }]]);
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('sends a trimmed new title', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const { dialog } = await openEdit(onSubmit);
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, '  Renamed  ');
    await userEvent.click(button(dialog, 'Save'));
    expect(onSubmit.mock.calls).toEqual([[{ title: 'Renamed' }]]);
  });

  it('saves and finalizes in one request, with or without changes', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const first = await openEdit(onSubmit);
    await userEvent.click(button(first.dialog, 'Save and finalize'));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ finalize: true });
    await waitFor(() => expect(first.onClosed).toHaveBeenCalledTimes(1));
    cleanup();

    const second = await openEdit(onSubmit);
    setDescription('changed', second.dialog);
    await userEvent.click(button(second.dialog, 'Save and finalize'));
    expect(onSubmit.mock.calls[1]?.[0]).toEqual({ description: 'changed', finalize: true });
  });

  it('normalizes CRLF line endings of the stored text', async () => {
    const onSubmit = vi.fn(async (_data: Data) => undefined);
    const card = makeCard({ id: 3, isDraft: true, description: 'a\r\nb' });
    const { dialog } = await openEdit(onSubmit, card);
    expect(descriptionOf(dialog)).toBe('a\nb');
    expect(button(dialog, 'Save').disabled).toBe(true);
  });

  it('blocks a second submit and every way of closing while saving', async () => {
    const pending = deferred();
    const onSubmit = vi.fn((_data: Data) => pending.promise);
    const { dialog, onClosed } = await openEdit(onSubmit);
    setDescription('slow', dialog);
    await userEvent.click(button(dialog, 'Save'));

    expect(button(dialog, 'Saving…').disabled).toBe(true);
    expect(button(dialog, 'Save and finalize').disabled).toBe(true);
    expect(button(dialog, 'Cancel').disabled).toBe(true);
    expect(button(dialog, 'Close').disabled).toBe(true);
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');

    await userEvent.keyboard('{Escape}');
    await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]') as Element);
    await userEvent.click(button(dialog, 'Save and finalize'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.queryByText('Discard changes?')).toBeNull();

    await act(async () => pending.resolve());
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });
});

describe('save failures', () => {
  it('keeps the dialog and the input, shows the server message and retries', async () => {
    const onSubmit = vi
      .fn<(data: Data) => Promise<void>>()
      .mockRejectedValueOnce(new WriteError('Description is too long.', 422, 'invalid_value'))
      .mockResolvedValueOnce(undefined);
    const { dialog, onClosed } = await openEdit(onSubmit);
    setDescription('keep this', dialog);
    await userEvent.click(button(dialog, 'Save'));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Description is too long.');
    expect(onClosed).not.toHaveBeenCalled();
    expect(descriptionOf(dialog)).toBe('keep this');
    expect(button(dialog, 'Cancel').disabled).toBe(false);

    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]?.[0]).toEqual({ description: 'keep this' });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
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
    expect(button(dialog, 'Retry and save').disabled).toBe(false);
  });

  it('retries a failed save and finalize as a save and finalize', async () => {
    const onSubmit = vi
      .fn<(data: Data) => Promise<void>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(undefined);
    const { dialog, onClosed } = await openEdit(onSubmit);
    await userEvent.click(button(dialog, 'Save and finalize'));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Retry' }));
    expect(onSubmit.mock.calls[1]?.[0]).toEqual({ finalize: true });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
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
    expect(button(dialog, 'Save and finalize').disabled).toBe(false);
    expect(within(dialog).getByText('50,000 / 50,000').getAttribute('data-over')).toBeNull();

    setDescription('あ'.repeat(50_001), dialog);
    expect(button(dialog, 'Save').disabled).toBe(true);
    expect(button(dialog, 'Save and finalize').disabled).toBe(true);
    expect(within(dialog).getByText('50,001 / 50,000').getAttribute('data-over')).toBe('true');
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
    await userEvent.clear(title);
    expect(button(dialog, 'Save and finalize').disabled).toBe(true);
    await userEvent.type(title, '   ');
    expect(button(dialog, 'Save').disabled).toBe(true);
    expect(button(dialog, 'Save and finalize').disabled).toBe(true);
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

  it('keeps Tab inside the dialog', async () => {
    const { dialog } = await openEdit();
    for (let step = 0; step < 14; step++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
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

  it('patches the draft with the changed fields and the finalize flag', async () => {
    const fetchMock = stubFetch(200, { card: DRAFT });
    const { dialog, onClosed } = await openEdit((data) =>
      editCard(PROJECT, DRAFT.id, data).then(() => undefined),
    );
    setDescription('## Body', dialog);
    await userEvent.click(button(dialog, 'Save and finalize'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/projects/${PROJECT}/cards/14`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ description: '## Body', finalize: true });
  });

  it('shows the reason of a 422 from the server and keeps the dialog', async () => {
    stubFetch(422, {
      error: { code: 'invalid_value', message: 'x', reason: 'Description is 50,001 of 50,000.' },
    });
    const { dialog, onClosed } = await openEdit((data) =>
      editCard(PROJECT, DRAFT.id, data).then(() => undefined),
    );
    setDescription('x', dialog);
    await userEvent.click(button(dialog, 'Save'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Description is 50,001 of 50,000.',
    );
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('maps a 409 card_not_draft to the not-a-draft message', async () => {
    stubFetch(409, {
      error: { code: 'card_not_draft', message: 'x', reason: 'Card #14 is not a draft.' },
    });
    const { dialog } = await openEdit((data) =>
      editCard(PROJECT, DRAFT.id, data).then(() => undefined),
    );
    setDescription('x', dialog);
    await userEvent.click(button(dialog, 'Save'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'This card is not a draft.',
    );
  });
});
