import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionDialog } from '../../src/components/ActionDialog';
import { selectLocale } from '../../src/i18n';
import { fixtureCard } from '../fixtures';

beforeEach(() => selectLocale('en'));
afterEach(cleanup);

describe('edit action', () => {
  it('opens the placeholder dialog for the card and closes it', async () => {
    const onClose = vi.fn();
    const card = fixtureCard(8);
    render(
      <ActionDialog action={{ kind: 'edit', card }} onClose={onClose} onSubmit={async () => {}} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit card' });
    expect(dialog.textContent).toContain('Not implemented');
    expect(dialog.textContent).toContain(`#${card.id} ${card.title}`);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
