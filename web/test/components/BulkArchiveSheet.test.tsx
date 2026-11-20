import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BulkArchiveDialog } from '../../src/features/tasks/archive/BulkArchiveDialog';
import { selectLocale } from '../../src/shared/i18n';
import { makeTask } from '../fixtures';

beforeEach(() => selectLocale('en'));
afterEach(cleanup);

const drag = (handle: Element) => {
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, isPrimary: true, clientY: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 220 });
};

describe('the bulk archive sheet', () => {
  it('can be dragged until the archive runs, and not while it blocks closing', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    render(
      <BulkArchiveDialog
        projectName="agent-board"
        targets={[makeTask({ id: 1, title: 'One', taskStatus: 'done' })]}
        saving={false}
        kind="sheet"
        onConfirm={() => pending}
        onCancel={() => {}}
      />,
    );
    const sheet = await screen.findByRole('dialog');
    const top = sheet.querySelector('.mobile-drawer__top') as HTMLElement;

    // Before the archive runs the drag takes hold of the sheet.
    drag(top);
    expect(sheet.hasAttribute('data-swiping')).toBe(true);
    fireEvent.pointerCancel(top, { pointerId: 1 });

    // While the archive runs, closing is refused, so a drag must not move the sheet at all.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Archive 1/ }));
    });
    drag(top);
    expect(sheet.hasAttribute('data-swiping')).toBe(false);
    expect(sheet.style.getPropertyValue('--drawer-drag-y')).toBe('');
    await act(async () => finish());
  });

  it('returns to rest when the archive starts in the middle of a drag', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    render(
      <BulkArchiveDialog
        projectName="agent-board"
        targets={[makeTask({ id: 1, title: 'One', taskStatus: 'done' })]}
        saving={false}
        kind="sheet"
        onConfirm={() => pending}
        onCancel={() => {}}
      />,
    );
    const sheet = await screen.findByRole('dialog');
    const top = sheet.querySelector('.mobile-drawer__top') as HTMLElement;

    drag(top);
    expect(sheet.hasAttribute('data-swiping')).toBe(true);
    // The archive starts while the finger is still down.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Archive 1/ }));
    });
    expect(sheet.hasAttribute('data-swiping')).toBe(false);
    expect(sheet.style.getPropertyValue('--drawer-drag-y')).toBe('');
    // Releasing far past the dismiss distance must neither move nor close the sheet.
    fireEvent.pointerMove(top, { pointerId: 1, clientY: 900 });
    fireEvent.pointerUp(top, { pointerId: 1, clientY: 900 });
    expect(sheet.style.getPropertyValue('--drawer-drag-y')).toBe('');
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await act(async () => finish());
  });
});
