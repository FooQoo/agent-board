import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PushPromptDialogView } from './PushPromptDialogView';

describe('PushPromptDialogView', () => {
  it('turns notifications on from one button and closes from Not now', () => {
    const onEnable = vi.fn();
    const onClose = vi.fn();
    render(<PushPromptDialogView onEnable={onEnable} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
    expect(onEnable).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows a failure and locks the buttons while working', () => {
    render(<PushPromptDialogView busy failed onEnable={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Could not change');
    expect(screen.getByRole('button', { name: 'Enable notifications' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
