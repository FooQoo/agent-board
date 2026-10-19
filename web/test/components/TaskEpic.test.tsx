import { render, screen } from '@testing-library/react';
import { renderEpicLabel } from '../support/composition';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TaskCard } from '../../src/features/tasks/card/TaskCard';
import { makeTask } from '../fixtures';

const epic = { id: 'FILE-SHARE', name: 'File share', color: '#7C3AED' };

describe('Task epic label', () => {
  it('shows the EPIC-ID under the title and gives the task no epic-colored frame', () => {
    const task = makeTask({ id: 20, title: 'Labeled', epic });
    const { container } = render(
      <TaskCard task={task} selected={false} onSelect={() => {}} renderEpic={renderEpicLabel()} />,
    );
    const label = screen.getByRole('button', { name: 'FILE-SHARE' });
    const title = screen.getByText('Labeled');
    expect(title.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const root = container.querySelector('.card') as HTMLElement;
    expect(root.classList.contains('card--epic')).toBe(false);
    expect(root.getAttribute('style')).toBeNull();
    // Only the label carries the epic color.
    expect((label as HTMLElement).style.background).not.toBe('');
  });

  it('shows no epic label for a task without an epic', () => {
    const { container } = render(
      <TaskCard task={makeTask({ id: 21, epic: null })} selected={false} onSelect={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'FILE-SHARE' })).toBeNull();
    expect(container.querySelector('.card')?.getAttribute('style')).toBeNull();
  });

  it('keeps the pending look of a task that belongs to an epic', () => {
    const task = makeTask({
      id: 22,
      epic,
      taskStatus: 'doing',
      agentStatus: 'pending',
      pendingReason: 'Waiting',
    });
    const { container } = render(
      <TaskCard task={task} selected={true} onSelect={() => {}} renderEpic={renderEpicLabel()} />,
    );
    expect(container.querySelector('.card--pending')).not.toBeNull();
    expect(container.querySelector('.card--selected')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'FILE-SHARE' })).toBeTruthy();
  });

  it('passes a press on the label to the epic handler and does not select the task', async () => {
    const onSelect = vi.fn();
    const onOpenEpic = vi.fn();
    render(
      <TaskCard
        task={makeTask({ id: 23, epic })}
        selected={false}
        onSelect={onSelect}
        renderEpic={renderEpicLabel(onOpenEpic)}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'FILE-SHARE' }));
    expect(onOpenEpic).toHaveBeenCalledWith(epic.id);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects the task when the title is pressed', async () => {
    const onSelect = vi.fn();
    render(
      <TaskCard
        task={makeTask({ id: 24, title: 'Plain', epic })}
        selected={false}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByText('Plain'));
    expect(onSelect).toHaveBeenCalledWith(24);
  });
});

describe('task frames', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/shared/styles/app.css'), 'utf8');

  it('never take the epic color: a task has the normal border, a selected task the accent frame only', () => {
    expect(css).not.toContain('epic-color');
    expect(css).not.toContain('.card--epic');
    const selected = css.slice(css.indexOf('.card--selected {'));
    expect(selected.slice(0, selected.indexOf('}'))).toContain('border-color: var(--r-accent)');
  });
});
