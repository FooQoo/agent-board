import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { keepFocusOnPress } from './keepFocus';

function Composer({ onSend, disabled = false }: { onSend: () => void; disabled?: boolean }) {
  return (
    <>
      <textarea aria-label="request" />
      <Button type="button" disabled={disabled} onClick={onSend} {...keepFocusOnPress}>
        send
      </Button>
    </>
  );
}

describe('keepFocusOnPress', () => {
  it('cancels the press so the field keeps focus, and one click sends', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const field = screen.getByLabelText('request');
    const button = screen.getByRole('button', { name: 'send' });
    field.focus();

    for (const type of ['pointerDown', 'mouseDown'] as const) {
      const press = createEvent[type](button);
      fireEvent(button, press);
      expect(press.defaultPrevented).toBe(true);
    }
    expect(document.activeElement).toBe(field);

    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('still sends from the keyboard', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    screen.getByRole('button', { name: 'send' }).click();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not send while disabled', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    expect(onSend).not.toHaveBeenCalled();
  });
});
