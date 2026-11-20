import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../../../shared/i18n';
import { health } from '../fixtures';
import { ResidentIndicator } from './ResidentFooter';

afterEach(cleanup);

describe('ResidentIndicator', () => {
  it('is display-only without onOpen, and says the state in words with withState', () => {
    render(
      <ResidentIndicator health={health({ state: 'running', tool: 'claude-code' })} withState />,
    );
    const indicator = screen.getByRole('img', { name: 'Claude Code: Working on a task' });
    expect(indicator.tagName).toBe('SPAN');
    expect(indicator.textContent).toContain('Claude Code');
    expect(indicator.textContent).toContain('working');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says a working session waits for subagents, and not an idle one', () => {
    const tasks = ['Review the diff'];
    const { rerender } = render(
      <ResidentIndicator
        health={health({ state: 'running', tool: 'claude-code', backgroundTasks: tasks })}
        withState
      />,
    );
    const indicator = screen.getByRole('img', {
      name: 'Claude Code: Working (waiting for subagents)',
    });
    expect(indicator.textContent).toContain('working (subagents)');
    rerender(
      <ResidentIndicator
        health={health({
          state: 'running',
          tool: 'claude-code',
          waiting: true,
          backgroundTasks: tasks,
        })}
        withState
      />,
    );
    expect(screen.getByRole('img', { name: 'Claude Code: Waiting' })).toBeTruthy();
  });

  it('draws nothing while nothing is launched and auto-start is off', () => {
    const { container } = render(<ResidentIndicator health={health({})} withState />);
    expect(container.innerHTML).toBe('');
  });

  it('warns about stalled items on the PC and names them for assistive tech', () => {
    const stalled = health({
      state: 'running',
      tool: 'codex',
      pushStalled: [{ kind: 'task', id: '12', attempts: 3, lastError: null, onHold: false }],
    });
    render(<ResidentIndicator health={stalled} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: /could not be handled: Task #12/ })).toBeTruthy();
    expect(screen.getByText('Some items could not be handled (1)')).toBeTruthy();
  });

  it('shows items left on hold neutrally, not as a warning', () => {
    const held = health({
      state: 'running',
      tool: 'codex',
      pushStalled: [{ kind: 'task', id: '12', attempts: 3, lastError: null, onHold: true }],
    });
    render(<ResidentIndicator health={held} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: /On hold: Task #12/ })).toBeTruthy();
    expect(screen.getByText('On hold (1)')).toBeTruthy();
    expect(screen.queryByText(/could not be handled/)).toBeNull();
  });

  it('shows only the icon on the display-only view', () => {
    const stalled = health({
      state: 'running',
      tool: 'codex',
      pushStalled: [{ kind: 'task', id: '12', attempts: 3, lastError: null, onHold: false }],
    });
    render(<ResidentIndicator health={stalled} />);
    expect(screen.queryByText(/could not be handled/)).toBeNull();
    expect(screen.getByRole('img', { name: /Task #12/ })).toBeTruthy();
  });

  it('is a button that opens the dialog when onOpen is given', () => {
    render(
      <ResidentIndicator health={health({ state: 'failed', tool: 'codex' })} onOpen={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Codex: Failed' })).toBeTruthy();
  });
});
