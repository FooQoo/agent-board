import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { AcceptanceTabView } from '../../src/components/detail/AcceptanceTabView';
import { selectLocale } from '../../src/i18n';
import type { Epic } from '../../src/types';

beforeEach(() => selectLocale('en'));

it('keeps card conditions visible when a partial epic response lacks conditions', () => {
  render(
    <AcceptanceTabView
      card={{
        acceptance: [{ id: 'AC-1', text: 'Card condition', done: false }],
        acceptanceError: false,
      }}
      epic={{ body: 'Older epic response' } as Epic}
      epicStatus="ready"
    />,
  );
  expect(screen.getByText('Card condition')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Acceptance conditions cannot be read');
});

it('shows all conditions read-only without nested fold controls', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `AC-${i + 1}`,
    text: `Condition ${i + 1}`,
    done: i === 0,
  }));
  render(
    <AcceptanceTabView
      card={{ acceptance: items, acceptanceError: false }}
      epic={null}
      epicStatus="none"
    />,
  );
  expect(screen.getAllByRole('checkbox')).toHaveLength(12);
  expect(screen.queryByRole('button')).toBeNull();
  for (const input of screen.getAllByRole('checkbox'))
    expect((input as HTMLInputElement).disabled).toBe(true);
});

it('keeps card and epic conditions in separate sections and names the source', () => {
  const epic = {
    acceptance: [{ id: 'AC-1', text: 'Epic condition', done: true }],
    acceptanceError: false,
  } as Epic;
  render(
    <AcceptanceTabView
      card={{
        acceptance: [{ id: 'AC-1', text: 'Card condition', done: false }],
        acceptanceError: false,
      }}
      epic={epic}
      epicStatus="ready"
    />,
  );
  expect(
    within(screen.getByRole('region', { name: 'Card' })).getByText('Card condition'),
  ).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: 'Epic' })).getByText('Epic condition'),
  ).toBeTruthy();
});

it('handles empty and unreadable conditions without presenting invalid progress', () => {
  const { rerender } = render(
    <AcceptanceTabView
      card={{ acceptance: [], acceptanceError: false }}
      epic={null}
      epicStatus="none"
    />,
  );
  expect(screen.getByText('No acceptance conditions.')).toBeTruthy();
  rerender(
    <AcceptanceTabView
      card={{ acceptance: [], acceptanceError: true }}
      epic={null}
      epicStatus="none"
    />,
  );
  expect(screen.getByRole('status').textContent).toBe('Acceptance conditions cannot be read');
});

it('can retry an epic read without changing the card conditions', async () => {
  const retry = vi.fn();
  render(
    <AcceptanceTabView
      card={{
        acceptance: [{ id: 'AC-1', text: 'Card condition', done: false }],
        acceptanceError: false,
      }}
      epic={null}
      epicStatus="failed"
      onRetryEpic={retry}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByText('Card condition')).toBeTruthy();
});
