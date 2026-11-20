import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionDialog, type DialogAction } from '../../src/app/dialogs/ActionDialog';
import { selectLocale } from '../../src/shared/i18n';

vi.mock(
  '../../src/shared/rich-editor/RichMarkdownEditor',
  () => import('../editor/fakeRichEditor'),
);

type Data = Parameters<React.ComponentProps<typeof ActionDialog>['onSubmit']>[0];

function Host({
  action,
  onSubmit,
  onClosed,
}: {
  action: DialogAction;
  onSubmit: (data: Data) => Promise<void>;
  onClosed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open action
      </button>
      {open && (
        <ActionDialog
          action={action}
          onSubmit={onSubmit}
          onClose={() => {
            setOpen(false);
            onClosed?.();
          }}
        />
      )}
    </>
  );
}

async function openHost(action: DialogAction, onSubmit: (data: Data) => Promise<void>) {
  const onClosed = vi.fn();
  render(<Host action={action} onSubmit={onSubmit} onClosed={onClosed} />);
  const opener = screen.getByRole('button', { name: 'Open action' });
  await userEvent.click(opener);
  return { opener, onClosed, dialog: screen.getByRole('dialog') };
}

beforeEach(() => selectLocale('en'));
afterEach(() => {
  cleanup();
  selectLocale('en');
  window.localStorage.clear();
});

describe('closing and focus', () => {
  it('closes with Escape, and the close button, and returns focus to the opener', async () => {
    for (const how of ['escape', 'close'] as const) {
      const { opener, onClosed, dialog } = await openHost(
        { kind: 'request' },
        async () => undefined,
      );
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      if (how === 'escape') await userEvent.keyboard('{Escape}');
      else await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
      cleanup();
    }
  });

  it('keeps Tab inside the dialog', async () => {
    const { dialog } = await openHost({ kind: 'request' }, async () => undefined);
    for (let step = 0; step < 12; step++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('opening on a touch screen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the focus on the dialog so the software keyboard stays down', async () => {
    const real = window.matchMedia;
    vi.stubGlobal('matchMedia', (media: string) => ({
      ...real(media),
      matches: media === '(pointer: coarse)',
    }));
    const { dialog } = await openHost({ kind: 'request' }, async () => undefined);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const active = document.activeElement;
    expect(active).toBe(dialog);
    expect(active?.matches('input, textarea, [contenteditable="true"]')).toBe(false);
  });
});
