import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Card } from '../../src/components/Card';
import { fixtureCard, makeCard } from '../fixtures';

const noop = () => {};

describe('Card', () => {
  it('shows the id, title and the local update time', () => {
    render(<Card card={fixtureCard(14)} selected={false} onSelect={noop} />);
    expect(screen.getByText('#14')).toBeTruthy();
    expect(screen.getByText('Prepare the Windows build')).toBeTruthy();
    expect(screen.getByText('Updated 10/02 10:08')).toBeTruthy();
  });

  it('shows no run state for cards in Todo or Done', () => {
    const { rerender } = render(<Card card={fixtureCard(14)} selected={false} onSelect={noop} />);
    for (const label of ['Idle', 'Running', 'Pending']) expect(screen.queryByText(label)).toBeNull();
    rerender(<Card card={fixtureCard(8)} selected={false} onSelect={noop} />);
    for (const label of ['Idle', 'Running', 'Pending']) expect(screen.queryByText(label)).toBeNull();
  });

  it('shows the run state badge for cards in Doing', () => {
    const { rerender } = render(<Card card={fixtureCard(11)} selected={false} onSelect={noop} />);
    expect(screen.getByText('Running')).toBeTruthy();
    rerender(<Card card={fixtureCard(13)} selected={false} onSelect={noop} />);
    expect(screen.getByText('Idle')).toBeTruthy();
    rerender(<Card card={fixtureCard(12)} selected={false} onSelect={noop} />);
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('shows the waiting reason only for pending cards', () => {
    const { rerender } = render(<Card card={fixtureCard(12)} selected={false} onSelect={noop} />);
    expect(screen.getByText('Waiting for confirmation on how to replace a board.')).toBeTruthy();
    rerender(<Card card={fixtureCard(11)} selected={false} onSelect={noop} />);
    expect(screen.queryByText(/Waiting for/)).toBeNull();
  });

  it('marks pending cards so they can be highlighted', () => {
    const { container } = render(<Card card={fixtureCard(12)} selected={false} onSelect={noop} />);
    expect(container.querySelector('.card--pending')).not.toBeNull();
  });

  it('renders markup in a title as plain text', () => {
    const card = makeCard({ id: 30, title: '<b>Bold</b> <script>alert(1)</script>' });
    const { container } = render(<Card card={card} selected={false} onSelect={noop} />);
    expect(screen.getByText('<b>Bold</b> <script>alert(1)</script>')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('reflects the selection and reports clicks', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<Card card={fixtureCard(8)} selected={false} onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: /Initialize the board/ });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(8);
    rerender(<Card card={fixtureCard(8)} selected={true} onSelect={onSelect} />);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws the grip as decoration that cannot take focus', async () => {
    const { container } = render(<Card card={fixtureCard(8)} selected={false} onSelect={noop} />);
    const grip = container.querySelector('svg.grip');
    expect(grip).not.toBeNull();
    expect(grip?.getAttribute('aria-hidden')).toBe('true');
    expect(grip?.getAttribute('focusable')).toBe('false');
    const button = screen.getByRole('button');
    await userEvent.tab();
    expect(document.activeElement).toBe(button);
    await userEvent.tab();
    expect(document.activeElement).toBe(document.body);
  });
});
