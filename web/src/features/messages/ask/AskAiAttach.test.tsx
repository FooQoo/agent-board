import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@/shared/i18n';
import { AskAiDialog } from './AskAiDialog';
import type { PickerTask } from './pickerTasks';

const TASKS: PickerTask[] = [
  { id: 552, title: 'Jump from a result', taskStatus: 'doing' },
  { id: 651, title: 'Hide the project name', taskStatus: 'doing' },
  { id: 559, title: 'Keep the phone draft', taskStatus: 'done' },
];

const field = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What would you like done?' });
const box = (id: number) => screen.findByRole('checkbox', { name: new RegExp(`#${id}`) });
const checked = (element: HTMLElement) => element.getAttribute('aria-checked') === 'true';
const gone = () => waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());

describe('Attach task in the Ask AI composer', () => {
  it('has no button without tasks', () => {
    const { unmount } = render(<AskAiDialog onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Attach task/ })).toBeNull();
    unmount();
  });

  // One render for the whole flow: the request text is the only state, so every step reads it again.
  it('writes, re-reads, replaces and removes the attachment line', async () => {
    const user = userEvent.setup();
    render(
      <AskAiDialog
        initialText={'See #552 first\nFix it'}
        tasks={TASKS}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const open = (name: string) => user.click(screen.getByRole('button', { name }));

    // A reference in the middle of the text is not an attachment.
    await open('Attach task');
    expect(checked(await box(552))).toBe(false);
    await user.click(await box(552));
    await user.click(await box(651));
    await user.click(screen.getByRole('button', { name: 'Attach (2)' }));
    await gone();
    expect(field().value).toBe('See #552 first\nFix it\n#552 #651');

    // Reopening shows what the text says, and a confirm replaces the line.
    await open('Attach task (2)');
    expect(checked(await box(552))).toBe(true);
    expect(checked(await box(651))).toBe(true);
    expect(checked(await box(559))).toBe(false);
    await user.click(await box(651));
    await user.click(await box(559));
    await user.click(screen.getByRole('button', { name: 'Attach (2)' }));
    await gone();
    expect(field().value).toBe('See #552 first\nFix it\n#552 #559');

    // A manual edit of the line shows up the next time the picker opens; Escape changes nothing.
    await user.clear(field());
    await user.type(field(), 'Fix it{Enter}#651');
    await open('Attach task (1)');
    expect(checked(await box(651))).toBe(true);
    expect(checked(await box(552))).toBe(false);
    await user.keyboard('{Escape}');
    await gone();
    expect(field().value).toBe('Fix it\n#651');

    // Search by number and by title; confirming with nothing selected removes the line.
    await open('Attach task (1)');
    const search = await screen.findByRole('searchbox', { name: /Search tasks/ });
    await user.type(search, '55');
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    await user.clear(search);
    await user.type(search, 'phone');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await user.type(search, 'zzz');
    expect(screen.getByText('No matching tasks.')).toBeTruthy();
    await user.clear(search);
    await user.click(await box(651));
    await user.click(screen.getByRole('button', { name: 'Attach (0)' }));
    await gone();
    expect(field().value).toBe('Fix it');
    expect(screen.getByRole('button', { name: 'Attach task' })).toBeTruthy();
  });
});
