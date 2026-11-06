import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSaveShortcut } from '../../src/shared/ui/editor/useSaveShortcut';

function Host({ onSave }: { onSave?: () => void }) {
  useSaveShortcut(onSave);
  return null;
}

/** Presses the keys; true when the browser's own Save page was stopped. */
function press(init: KeyboardEventInit): boolean {
  return !fireEvent.keyDown(document.body, init);
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('useSaveShortcut', () => {
  it('saves on Cmd+S and Ctrl+S instead of the browser saving the page', () => {
    const onSave = vi.fn();
    render(<Host onSave={onSave} />);
    expect(press({ key: 's', metaKey: true })).toBe(true);
    expect(press({ key: 'S', ctrlKey: true })).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('leaves other keys alone', () => {
    const onSave = vi.fn();
    render(<Host onSave={onSave} />);
    expect(press({ key: 's' })).toBe(false);
    expect(press({ key: 's', metaKey: true, shiftKey: true })).toBe(false);
    expect(press({ key: 's', ctrlKey: true, altKey: true })).toBe(false);
    expect(press({ key: 'a', metaKey: true })).toBe(false);
    expect(press({ key: 's', metaKey: true, isComposing: true })).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves once while the keys are held', () => {
    const onSave = vi.fn();
    render(<Host onSave={onSave} />);
    press({ key: 's', metaKey: true });
    expect(press({ key: 's', metaKey: true, repeat: true })).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it.each(['editor-confirm', 'lightbox'])('does not save under the %s on top', (kind) => {
    const onSave = vi.fn();
    render(<Host onSave={onSave} />);
    const cover = document.createElement('div');
    if (kind === 'lightbox') cover.setAttribute('data-lightbox', '');
    else cover.className = kind;
    document.body.append(cover);
    expect(press({ key: 's', metaKey: true })).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does nothing without a save and after the dialog is gone', () => {
    const onSave = vi.fn();
    const { rerender, unmount } = render(<Host />);
    expect(press({ key: 's', metaKey: true })).toBe(false);
    rerender(<Host onSave={onSave} />);
    unmount();
    expect(press({ key: 's', metaKey: true })).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });
});
