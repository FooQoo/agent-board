import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderProgressTask } from '../support/composition';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteError } from '../../src/app/api';
import { EpicDialog, type EpicApi } from '../../src/features/epics/editor/EpicDialog';
import { selectLocale } from '../../src/shared/i18n';
import type { Task, Epic } from '../../src/shared/api/contracts';
import { makeTask } from '../fixtures';

vi.mock(
  '../../src/shared/rich-editor/RichMarkdownEditor',
  () => import('../editor/fakeRichEditor'),
);

const PLAN = '## Goal\n\nShare the plan.\n\n## Steps\n\nDo it.';
const IMAGE = 'c'.repeat(32);

const EPIC: Epic = {
  id: 'FILE-SHARE',
  name: 'File share',
  color: '#7C3AED',
  isDraft: false,
  plan: PLAN,
  body: PLAN,
  priority: [],
  priorityError: false,
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

function tasks(): Task[] {
  return [
    makeTask({ id: 24, title: 'Save shared doc', taskStatus: 'done', epic: ref }),
    makeTask({ id: 25, title: 'Image preview', taskStatus: 'doing', assignee: 'ai', epic: ref }),
    makeTask({ id: 27, title: 'Sync to board', taskStatus: 'todo' }),
    makeTask({
      id: 28,
      title: 'CLI command',
      taskStatus: 'todo',
      epic: { id: 'OTHER', name: 'Other', color: '#111111' },
    }),
    makeTask({ id: 29, title: 'Plain task', taskStatus: 'todo' }),
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
    savePriority: vi.fn(async (priority: number[]) => {
      calls.push(`savePriority:${priority.join(',')}`);
    }),
    remove: vi.fn(async () => {
      calls.push('remove');
    }),
    ...overrides,
  };
  return { api, calls };
}

async function openEpic(
  api: EpicApi,
  options: { onOpenTask?: (id: number) => void; epic?: Epic; board?: Task[] } = {},
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
            tasks={options.board ?? tasks()}
            api={api}
            renderTask={renderProgressTask}
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
function rowName(root: HTMLElement, id: number): HTMLButtonElement {
  const row = root.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
  if (!row) throw new Error(`no row for #${id}`);
  return within(row).getByRole('button') as HTMLButtonElement;
}

/** The images panel folds by default; a test opens it before it reads or removes an image. */
async function openImages(root: HTMLElement) {
  await userEvent.click(within(root).getByRole('button', { name: /^Attachments/ }));
}

function rowIds(root: HTMLElement): string[] {
  const list = within(root).getByRole('list', { name: 'Progress' });
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
    await openImages(aside);
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
    expect(within(dialog).queryByText('Draft', { selector: '.editor__badge' })).toBeNull();
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
    expect(rowIds(dialog)).toEqual(['24', '25']);
    await openImages(dialog);
    expect(within(dialog).getByRole('region', { name: 'Image attachments' })).toBeTruthy();
    expect(within(dialog).getByText('shot.png')).toBeTruthy();
    expect(within(dialog).getByText('No changes')).toBeTruthy();
    expect(button(dialog, 'Save').disabled).toBe(true);
  });

  it('preserves a draft epic when saving its name', async () => {
    const { api } = fakeApi();
    const { dialog, onClosed } = await openEpic(api, { epic: { ...EPIC, isDraft: true } });
    setName('Renamed draft', dialog);
    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(api.saveDetails).toHaveBeenCalledWith({
      name: 'Renamed draft',
      color: EPIC.color.toUpperCase(),
      isDraft: true,
    });
  });
});

describe('progress table', () => {
  it('lists the tasks of the epic in the saved order, the unlisted ones after them by ID', async () => {
    const { api } = fakeApi();
    const epic = { ...EPIC, priority: [25, 24] };
    await openEpic(api, { epic });
    const dialog = await screen.findByRole('dialog');
    expect(rowIds(dialog)).toEqual(['25', '24']);
  });

  it('shows no membership checks and no task filter', async () => {
    const { api } = fakeApi();
    await openEpic(api);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Filter tasks' })).toBeNull();
    expect(within(dialog).queryByRole('checkbox', { name: /Include in this epic/ })).toBeNull();
  });
});

describe('saving', () => {
  it('saves reference conditions as plain Markdown without a separate conditions editor', async () => {
    const { api } = fakeApi();
    const { dialog, onClosed } = await openEpic(api);
    expect(within(dialog).queryByRole('button', { name: /^Acceptance conditions/ })).toBeNull();
    const text = `${PLAN}\n\n## Completion conditions\n\n- [ ] The plan is saved.`;
    setPlan(text, dialog);
    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(api.savePlan).toHaveBeenCalledWith({ body: text });
  });

  it('saves images, then the plan, then the name and color', async () => {
    const { api, calls } = fakeApi();
    const { dialog, onClosed } = await openEpic(api);
    await openImages(dialog);
    const file = new File(['x'], 'new.png', { type: 'image/png' });
    const input = within(dialog)
      .getByRole('region', { name: 'Image attachments' })
      .querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove shot.png' }));
    setPlan('## Goal\n\nChanged.', dialog);
    setName('Renamed epic', dialog);
    setColor('#00ff00', dialog);
    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      `removeImage:${IMAGE.slice(0, 4)}`,
      'addImages',
      'savePlan',
      'saveDetails',
    ]);
    expect(api.savePlan).toHaveBeenCalledWith({ body: '## Goal\n\nChanged.' });
    expect(api.saveDetails).toHaveBeenCalledWith({
      name: 'Renamed epic',
      color: '#00FF00',
      isDraft: EPIC.isDraft,
    });
  });

  it('does not send anything and keeps Save disabled when nothing changed', async () => {
    const { api, calls } = fakeApi();
    const { dialog } = await openEpic(api);
    expect(button(dialog, 'Save').disabled).toBe(true);
    expect(calls).toEqual([]);
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
    expect(rowName(dialog, 24).disabled).toBe(true);
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
    api.saveDetails = vi.fn(async () => {
      calls.push('saveDetails');
      if (failFirst) {
        failFirst = false;
        throw new WriteError('Epic is busy.', 409, 'epic_busy');
      }
    });
    const { dialog, onClosed } = await openEpic(api);
    setPlan('kept plan', dialog);
    setName('Renamed epic', dialog);
    await userEvent.click(button(dialog, 'Save'));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Could not save the name, color or draft.');
    expect(alert.textContent).toContain('Earlier changes were saved');
    expect(onClosed).not.toHaveBeenCalled();
    expect(bodyOf(dialog).value).toBe('kept plan');
    expect((within(dialog).getByLabelText('Formal name') as HTMLInputElement).value).toBe(
      'Renamed epic',
    );

    await userEvent.click(button(dialog, 'Save'));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['savePlan', 'saveDetails', 'saveDetails']);
  });

  it('stops at the image step and does not save the plan', async () => {
    const { api, calls } = fakeApi({
      removeImage: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    const { dialog } = await openEpic(api);
    setPlan('kept', dialog);
    await openImages(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove shot.png' }));
    await userEvent.click(button(dialog, 'Save'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('the images');
    expect(calls).toEqual([]);
    expect(bodyOf(dialog).value).toBe('kept');
  });
});

describe('deleting the epic', () => {
  it('asks first, Cancel keeps the epic, and Delete removes it and closes the dialog', async () => {
    const { api, calls } = fakeApi();
    const { dialog, onClosed } = await openEpic(api);
    await userEvent.click(button(dialog, 'Delete epic'));

    const confirm = await screen.findByRole('dialog', { name: 'Delete this epic?' });
    expect(within(confirm).getByText(/The plan and images of FILE-SHARE/)).toBeTruthy();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete this epic?' })).toBeNull(),
    );
    expect(calls).toEqual([]);
    expect(onClosed).not.toHaveBeenCalled();

    await userEvent.click(button(dialog, 'Delete epic'));
    const again = await screen.findByRole('dialog', { name: 'Delete this epic?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Delete epic' }));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['remove']);
  });

  it('keeps the dialog open and says why when a task still uses the epic', async () => {
    const { api } = fakeApi({
      remove: vi.fn(async () => {
        throw new WriteError('epic FILE-SHARE is used by tasks.', 409, 'epic_in_use');
      }),
    });
    const { dialog, onClosed } = await openEpic(api);
    await userEvent.click(button(dialog, 'Delete epic'));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this epic?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete epic' }));

    const alert = await within(confirm).findByRole('alert');
    expect(alert.textContent).toContain('A task still uses this epic.');
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('warns that unsaved changes are discarded too', async () => {
    const { api } = fakeApi();
    const { dialog } = await openEpic(api);
    setName('Renamed epic', dialog);
    await userEvent.click(button(dialog, 'Delete epic'));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this epic?' });
    expect(within(confirm).getByText(/Changes you have not saved in this dialog/)).toBeTruthy();
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
