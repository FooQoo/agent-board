import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { AcceptanceTabView } from '../../src/components/detail/AcceptanceTabView';
import { selectLocale } from '../../src/i18n';

beforeEach(() => selectLocale('en'));

it('shows only the task conditions, all read-only without fold controls', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `AC-${i + 1}`,
    text: `Condition ${i + 1}`,
    done: i === 0,
  }));
  render(<AcceptanceTabView task={{ acceptance: items, acceptanceError: false }} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(12);
  expect(screen.queryByRole('region', { name: 'Epic' })).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  for (const input of screen.getAllByRole('checkbox'))
    expect((input as HTMLInputElement).disabled).toBe(true);
});

it('handles empty and unreadable task conditions without invalid progress', () => {
  const { rerender } = render(
    <AcceptanceTabView task={{ acceptance: [], acceptanceError: false }} />,
  );
  expect(screen.getByText('No acceptance conditions.')).toBeTruthy();
  rerender(<AcceptanceTabView task={{ acceptance: [], acceptanceError: true }} />);
  expect(screen.getByRole('status').textContent).toBe('Acceptance conditions cannot be read');
});
