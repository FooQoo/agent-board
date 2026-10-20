import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestDialog, type RequestInput } from '../src/features/tasks/request/RequestDialog';
import { renderEpicBadge } from './support/composition';
import { selectLocale } from '../src/shared/i18n';
import type { Epic } from '../src/shared/api/contracts';

afterEach(cleanup);
beforeEach(() => selectLocale('en'));
afterEach(() => selectLocale('en'));

const epics: Epic[] = [
  {
    id: 'TASK-LISTEN',
    name: 'Task listening',
    color: '#3456ef',
    isDraft: false,
    document: '',
    body: '',
    priority: [],
    priorityError: false,
    attachments: [],
    createdAt: '',
    updatedAt: '',
  },
];

describe('simple request dialog', () => {
  it('keeps a failed request in the form and shows the server error', async () => {
    render(
      <RequestDialog
        epics={[]}
        onClose={vi.fn()}
        onSubmit={vi.fn().mockRejectedValue(new Error('Request failed (503)'))}
        onCreateManually={vi.fn()}
        renderEpic={renderEpicBadge}
      />,
    );
    const user = userEvent.setup();
    const textarea = screen.getByRole('textbox', { name: 'What should be done?' });
    await user.type(textarea, 'Keep this request');
    await user.click(screen.getByRole('button', { name: 'Submit task' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Request failed (503)');
    const footerCopy = alert.closest('.modal__footer-copy');
    expect(footerCopy).not.toBeNull();
    if (footerCopy === null) throw new Error('expected the error inside the footer copy');
    expect(footerCopy.contains(screen.getByRole('button', { name: 'Create manually' }))).toBe(true);
    expect((textarea as HTMLTextAreaElement).value).toBe('Keep this request');
  });

  it('submits a regular AI request with its original text and optional epic', async () => {
    const submit = vi
      .fn<(input: RequestInput) => Promise<void>>()
      .mockRejectedValueOnce(
        new Error('Could not save the task. Your input and images are kept. Try again.'),
      )
      .mockResolvedValueOnce();
    render(
      <RequestDialog
        epics={epics}
        onClose={vi.fn()}
        onSubmit={submit}
        onCreateManually={vi.fn()}
        renderEpic={renderEpicBadge}
      />,
    );
    expect(screen.getByText('Attachments (optional)')).toBeTruthy();
    const user = userEvent.setup();
    const textarea = screen.getByRole('textbox', { name: 'What should be done?' });
    fireEvent.change(textarea, {
      target: { value: '  First line\r\nsecond line  ' },
    });
    await user.click(screen.getByRole('button', { name: 'Epic (optional)' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Task listening' }));
    await user.click(screen.getByRole('button', { name: 'Submit task' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save the task');
    expect((textarea as HTMLTextAreaElement).value).toBe('  First line\nsecond line  ');
    await user.click(screen.getByRole('button', { name: 'Submit task' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    const first = submit.mock.calls[0]?.[0];
    const retry = submit.mock.calls[1]?.[0];
    expect(first).toBeDefined();
    expect(retry).toBeDefined();
    if (first === undefined || retry === undefined)
      throw new Error('expected both request attempts');
    expect(first).toMatchObject({ requestKind: 'simple', epicId: 'TASK-LISTEN', attachments: [] });
    expect(first).not.toHaveProperty('requestId');
    expect(retry).not.toHaveProperty('requestId');
    expect(first.description).toBe('  First line\nsecond line  ');
  });

  it('asks before discarding a request to switch to manual creation', async () => {
    const onCreateManually = vi.fn();
    render(
      <RequestDialog
        epics={[]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onCreateManually={onCreateManually}
        renderEpic={renderEpicBadge}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'What should be done?' }), 'Keep this');
    await user.click(screen.getByRole('button', { name: 'Create manually' }));
    expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onCreateManually).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('textbox', { name: 'What should be done?' }) as HTMLTextAreaElement).value,
    ).toBe('Keep this');
    await user.click(screen.getByRole('button', { name: 'Create manually' }));
    await user.click(screen.getByRole('button', { name: 'Discard and close' }));
    expect(onCreateManually).toHaveBeenCalledOnce();
  });
});
