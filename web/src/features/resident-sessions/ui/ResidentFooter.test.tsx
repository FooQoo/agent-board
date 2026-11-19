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

  it('draws nothing while nothing is launched and auto-start is off', () => {
    const { container } = render(<ResidentIndicator health={health({})} withState />);
    expect(container.innerHTML).toBe('');
  });

  it('is a button that opens the dialog when onOpen is given', () => {
    render(
      <ResidentIndicator health={health({ state: 'failed', tool: 'codex' })} onOpen={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Codex: Failed' })).toBeTruthy();
  });
});
