import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteError } from '../../src/api';
import { EpicDialog, type EpicApi } from '../../src/components/editor/EpicDialog';
import { selectLocale } from '../../src/i18n';
import type { Card, Epic } from '../../src/types';
import { makeCard } from '../fixtures';

vi.mock('../../src/components/editor/RichMarkdownEditor', () => import('../editor/fakeRichEditor'));

const PLAN = '## Goal\n\nShare the plan.\n\n## Steps\n\nDo it.';
const IMAGE = 'c'.repeat(32);

const EPIC: Epic = {
  id: 'FILE-SHARE',
  name: 'File share',
  color: '#7C3AED',
  isDraft: false,
  plan: PLAN,
  attachments: [
    {
      id: IMAGE,
      name: 'shot.png',
      mediaType: 'image/png',
      size: 10,
      createdAt: '2026-10-02T00:00:00Z',
    },
  ],
  createdAt: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
};

const ref = { id: 'FILE-SHARE', name: 'File share', color: '#7C3AED' };

function cards(): Card[] {
  return [
    makeCard({ id: 24, title: 'Save shared doc', cardStatus: 'done', epic: ref }),
    makeCard({ id: 25, title: 'Image preview', cardStatus: 'doing', assignee: 'ai', epic: ref }),
    makeCard({ id: 27, title: 'Sync to board', cardStatus: 'todo' }),
    makeCard({
      id: 28,
      title: 'CLI command',
      cardStatus: 'todo',
      epic: { id: 'OTHER', name: 'Other', color: '#111111' },
    }),
    makeCard({ id: 29, title: 'Plain card', cardStatus: 'todo' }),
  ];
}

function fakeApi(overrides: Partial<EpicApi> = {}) {
  const calls: string[] = [];
  const api: EpicApi = {
    addImages: vi.fn(async () => {
      calls.push('addImages');
    }),
    removeImage: vi.fn(async (id: string) => {
      calls.push(`removeImage:${id.slice(0, 4)}`);
    }),
    savePlan: vi.fn(async () => {
      calls.push('savePlan');
    }),
    saveDetails: vi.fn(async () => {
      calls.push('saveDetails');
    }),
    setMembership: vi.fn(async (cardId: number, epicId: string | null) => {
      calls.push(`setMembership:${cardId}:${epicId}`);
    }),
    ...overrides,
  };
  return { api, calls };
}

async function openEpic(
  api: EpicApi,
  options: { onOpenTask?: (id: number) => void; epic?: Epic; board?: Card[] } = {},
) {
  const onClosed = vi.fn();
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open epic
        </button>
        {open && (
          <EpicDialog
            epic={options.epic ?? EPIC}
            cards={options.board ?? cards()}
            api={api}
            onOpenTask={options.onOpenTask ?? vi.fn()}
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
  const opener = screen.getByRole('button', { name: 'Open epic' });
  await userEvent.click(opener);
  return {
    opener,
    onClosed,
    dialog: screen.getByRole('dialog', { name: /Edit epic|エピックを編集/ }),
  };
}

const button = (root: HTMLElement, name: string) =>
  within(root).getByRole('button', { name }) as HTMLButtonElement;

const bodyOf = (root: HTMLElement) =>
  within(root).getByRole('textbox', { name: 'Plan (Markdown)' }) as HTMLTextAreaElement;

function setPlan(text: string, root: HTMLElement) {
  fireEvent.change(bodyOf(root), { target: { value: text } });
}

function setName(text: string, root: HTMLElement) {
  fireEvent.change(within(root).getByLabelText('Formal name'), { target: { value: text } });
}

function setColor(text: string, root: HTMLElement) {
  const trigger = within(root).getByRole('button', { name: 'Choose a label color' });
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText('HEX'), { target: { value: text } });
  fireEvent.click(trigger);
}

/** The checkbox of the task with this ID in the task list. */
function include(root: HTMLElement, id: number) {
  const list = within(root).getByRole('list', { name: 'Tasks' });
  const row = within(list).getByText(`#${id}`).closest('li');
  if (!row) throw new Error(`no row for #${id}`);
  return within(row).getByRole('checkbox') as HTMLButtonElement;
}

function rowIds(root: HTMLElement): string[] {
  const list = within(root).getByRole('list', { name: 'Tasks' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('data-task-id') ?? '');
}

beforeEach(() => selectLocale('en'));
afterEach(() => {
  cleanup();
  selectLocale('en');
});

describe('epic dialog layout', () => {
  it('puts the label row in the right column above the images panel, and the name first in the centre', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    const row = dialog.querySelector('.epic-label-row') as HTMLElement;
    const aside = row.parentElement as HTMLElement;
    expect(aside.classList.contains('editor__aside')).toBe(true);
    const panel = within(aside).getByRole('region', { name: 'Image attachments' });
    expect(row.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(row).queryByLabelText('HEX')).toBeNull();
    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(within(row).getByLabelText('Choose a label color')).toBeTruthy();
    const main = dialog.querySelector('.editor__main') as HTMLElement;
    expect(main.contains(row)).toBe(false);
    expect(
      within(main.firstElementChild as HTMLElement).getByLabelText('Formal name'),
    ).toBeTruthy();
  });

  it('previews the color from the palette HEX field on the label', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    const row = dialog.querySelector('.epic-label-row') as HTMLElement;
    expect(within(dialog).queryByLabelText('HEX')).toBeNull();
    setColor('#00ff00', dialog);
    const chip = row.querySelector('.editor__epic-chip') as HTMLElement;
    expect(chip.style.background).toBe('rgb(0, 255, 0)');
    expect(within(dialog).queryByText('Use #RRGGBB.')).toBeNull();
    expect(row.querySelector('.epic-label-row__error')).toBeNull();
  });

  it('shows the epic ID, the title, the outline, the task list, the name, color, plan and images', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    expect(within(dialog).getAllByText('FILE-SHARE').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Edit epic')).toBeTruthy();
    expect(within(dialog).getByText('Draft', { selector: '.editor__badge' })).toBeTruthy();
    expect((within(dialog).getByLabelText('Formal name') as HTMLInputElement).value).toBe(
      'File share',
    );
    expect(
      (within(dialog).getByLabelText('Choose a label color') as HTMLButtonElement).style.background,
    ).toBe('rgb(124, 58, 237)');
    expect(
      within(within(dialog).getByRole('navigation', { name: 'Outline' }))
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['01Goal', '02Steps']);
    expect(within(dialog).getByRole('heading', { name: 'Tasks' })).toBeTruthy();
    expect(rowIds(dialog)).toEqual(['24', '25', '27', '28', '29']);
    expect(include(dialog, 24).getAttribute('aria-checked')).toBe('true');
    expect(include(dialog, 27).getAttribute('aria-checked')).toBe('false');
    expect(within(dialog).getByRole('region', { name: 'Image attachments' })).toBeTruthy();
    expect(within(dialog).getByText('shot.png')).toBeTruthy();
    expect(within(dialog).getByText('No changes')).toBeTruthy();
    expect(button(dialog, 'Save').disabled).toBe(true);
  });

  it('shows the count of member tasks and the Japanese wording', async () => {
    selectLocale('ja');
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    expect(within(dialog).getByText('エピックを編集')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'タスク' })).toBeTruthy();
    expect(within(dialog).getByText('2')).toBeTruthy();
    expect(within(dialog).getByText('変更はありません')).toBeTruthy();
    expect(within(dialog).queryByText('所属')).toBeNull();
  });

  it('shows the draft badge and draft box for a draft epic', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api, { epic: { ...EPIC, isDraft: true } });
    expect(within(dialog).getByText('Draft', { selector: '.editor__badge' })).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: 'Draft' }).getAttribute('data-state')).toBe(
      'checked',
    );
  });
});

describe('task filter', () => {
  it('cancels the tentative filter and restores the applied choices when reopened', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Filter tasks' }));
    const menu = await screen.findByRole('dialog', { name: 'Tasks to show' });
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'Other' }));
    await userEvent.click(within(menu).getByRole('button', { name: 'Cancel' }));
    expect(rowIds(dialog)).toEqual(['24', '25', '27', '28', '29']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Filter tasks' }));
    const reopened = await screen.findByRole('dialog', { name: 'Tasks to show' });
    expect(
      within(reopened).getByRole('checkbox', { name: 'Other' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(api.setMembership).not.toHaveBeenCalled();
  });

  it('shows only the chosen tasks after Apply, and changes nothing that is saved', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Filter tasks' }));
    const menu = await screen.findByRole('dialog', { name: 'Tasks to show' });
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'Other' }));
    expect(rowIds(dialog)).toEqual(['24', '25', '27', '28', '29']);
    await userEvent.click(within(menu).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(rowIds(dialog)).toEqual(['24', '25']));
    expect(api.saveDetails).not.toHaveBeenCalled();
    expect(api.setMembership).not.toHaveBeenCalled();
  });

  it('keeps the shown tasks when the menu is closed without Apply', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Filter tasks' }));
    const menu = await screen.findByRole('dialog', { name: 'Tasks to show' });
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'All' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tasks to show' })).toBeNull());
    expect(rowIds(dialog)).toEqual(['24', '25', '27', '28', '29']);
  });
});

describe('task membership', () => {
  it('toggles membership without moving the rows and saves only the changed tasks', async () => {
    const { api, calls } = fakeApi();
    const { dialog, onClosed } = await openEpic(api);
    const before = rowIds(dialog);
    await userEvent.click(include(dialog, 24));
    await userEvent.click(include(dialog, 27));
    expect(rowIds(dialog)).toEqual(before);
    expect(within(dialog).getByText('2')).toBeTruthy();
    expect(within(dialog).queryByText('No changes')).toBeNull();
    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['setMembership:24:null', 'setMembership:27:FILE-SHARE']);
  });

  it('keeps the membership changes when the filter changes', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    await userEvent.click(include(dialog, 24));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Filter tasks' }));
    const menu = await screen.findByRole('dialog', { name: 'Tasks to show' });
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'Other' }));
    await userEvent.click(within(menu).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(rowIds(dialog)).toEqual(['24', '25']));
    expect(include(dialog, 24).getAttribute('aria-checked')).toBe('false');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Filter tasks' }));
    const again = await screen.findByRole('dialog', { name: 'Tasks to show' });
    await userEvent.click(within(again).getByRole('checkbox', { name: 'Other' }));
    await userEvent.click(within(again).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(rowIds(dialog)).toEqual(['24', '25', '27', '28', '29']));
    expect(include(dialog, 24).getAttribute('aria-checked')).toBe('false');
  });
});

describe('saving', () => {
  it('saves images, then the plan, then the name, color and draft, then the tasks', async () => {
    const { api, calls } = fakeApi();
    const { dialog, onClosed } = await openEpic(api);
    const file = new File(['x'], 'new.png', { type: 'image/png' });
    const input = within(dialog)
      .getByRole('region', { name: 'Image attachments' })
      .querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove shot.png' }));
    setPlan('## Goal\n\nChanged.', dialog);
    setName('Renamed epic', dialog);
    setColor('#00ff00', dialog);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Draft' }));
    await userEvent.click(include(dialog, 29));
    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      `removeImage:${IMAGE.slice(0, 4)}`,
      'addImages',
      'savePlan',
      'saveDetails',
      'setMembership:29:FILE-SHARE',
    ]);
    expect(api.savePlan).toHaveBeenCalledWith('## Goal\n\nChanged.');
    expect(api.saveDetails).toHaveBeenCalledWith({
      name: 'Renamed epic',
      color: '#00FF00',
      isDraft: true,
    });
  });

  it('does not send the plan or the details when they did not change', async () => {
    const { api, calls } = fakeApi();
    const { dialog, onClosed } = await openEpic(api);
    await userEvent.click(include(dialog, 27));
    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['setMembership:27:FILE-SHARE']);
  });

  it('keeps Save disabled for an empty name', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    setName('', dialog);
    expect(button(dialog, 'Save').disabled).toBe(true);
  });

  it('blocks every edit and every close while saving', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { api } = fakeApi({ savePlan: vi.fn(() => pending) });
    const { dialog, onClosed } = await openEpic(api);
    setPlan('slow', dialog);
    await userEvent.click(button(dialog, 'Save'));
    expect(button(dialog, 'Saving…').disabled).toBe(true);
    expect(button(dialog, 'Cancel').disabled).toBe(true);
    expect((within(dialog).getByLabelText('Formal name') as HTMLInputElement).disabled).toBe(true);
    expect(bodyOf(dialog).disabled).toBe(true);
    expect(include(dialog, 24).disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(onClosed).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });
});

describe('save failures', () => {
  it('shows the step that failed, keeps the input, and retries only what is left', async () => {
    const { api, calls } = fakeApi();
    let failFirst = true;
    api.setMembership = vi.fn(async (cardId: number, epicId: string | null) => {
      calls.push(`setMembership:${cardId}:${epicId}`);
      if (failFirst) {
        failFirst = false;
        throw new WriteError('Card is archived.', 409, 'card_archived');
      }
    });
    const { dialog, onClosed } = await openEpic(api);
    setPlan('kept plan', dialog);
    await userEvent.click(include(dialog, 27));
    await userEvent.click(button(dialog, 'Save'));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Could not save the tasks.');
    expect(alert.textContent).toContain('Earlier changes were saved');
    expect(onClosed).not.toHaveBeenCalled();
    expect(bodyOf(dialog).value).toBe('kept plan');
    expect(include(dialog, 27).getAttribute('aria-checked')).toBe('true');

    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      'savePlan',
      'setMembership:27:FILE-SHARE',
      'setMembership:27:FILE-SHARE',
    ]);
  });

  it('stops at the image step and does not save the plan', async () => {
    const { api, calls } = fakeApi({
      removeImage: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    const { dialog } = await openEpic(api);
    setPlan('kept', dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove shot.png' }));
    await userEvent.click(button(dialog, 'Save'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('the images');
    expect(calls).toEqual([]);
    expect(bodyOf(dialog).value).toBe('kept');
  });
});

describe('task names and unsaved changes', () => {
  it('opens the task directly when nothing changed', async () => {
    const { api } = fakeApi();
    const onOpenTask = vi.fn();
    const { dialog } = await openEpic(api, { onOpenTask });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save shared doc' }));
    expect(onOpenTask).toHaveBeenCalledWith(24);
  });

  it('asks first when there are changes, Back keeps the edit, and Discard and move opens the task', async () => {
    const { api } = fakeApi();
    const onOpenTask = vi.fn();
    const { dialog } = await openEpic(api, { onOpenTask });
    setPlan('edited', dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save shared doc' }));
    const confirm = await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(onOpenTask).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull(),
    );
    expect(bodyOf(dialog).value).toBe('edited');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save shared doc' }));
    const again = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Discard and move' }));
    expect(onOpenTask).toHaveBeenCalledWith(24);
  });

  it('asks before closing with changes and returns the focus to the label on close', async () => {
    const { api } = fakeApi();
    const { dialog, onClosed, opener } = await openEpic(api);
    setName('Other name', dialog);
    await userEvent.click(button(dialog, 'Cancel'));
    const confirm = await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(onClosed).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Discard and close' }));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
