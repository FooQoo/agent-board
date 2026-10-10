import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Card } from '../../src/components/Card';
import { makeCard } from '../fixtures';

const epic = { id: 'FILE-SHARE', name: 'File share', color: '#7C3AED' };

describe('Card epic label', () => {
  it('shows the EPIC-ID under the title and frames the card in the epic color', () => {
    const card = makeCard({ id: 20, title: 'Labeled', epic });
    const { container } = render(<Card card={card} selected={false} onSelect={() => {}} />);
    const label = screen.getByRole('button', { name: 'FILE-SHARE' });
    const title = screen.getByText('Labeled');
    expect(title.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const root = container.querySelector('.card') as HTMLElement;
    expect(root.style.getPropertyValue('--epic-color')).toBe('#7C3AED');
  });

  it('shows no epic label for a card without an epic', () => {
    const { container } = render(
      <Card card={makeCard({ id: 21, epic: null })} selected={false} onSelect={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'FILE-SHARE' })).toBeNull();
    expect(container.querySelector('.card')?.getAttribute('style')).toBeNull();
  });

  it('keeps the pending look of a card that belongs to an epic', () => {
    const card = makeCard({
      id: 22,
      epic,
      cardStatus: 'doing',
      agentStatus: 'pending',
      pendingReason: 'Waiting',
    });
    const { container } = render(<Card card={card} selected={true} onSelect={() => {}} />);
    expect(container.querySelector('.card--pending')).not.toBeNull();
    expect(container.querySelector('.card--selected')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'FILE-SHARE' })).toBeTruthy();
  });

  it('passes a press on the label to the epic handler and does not select the card', async () => {
    const onSelect = vi.fn();
    const onOpenEpic = vi.fn();
    render(
      <Card
        card={makeCard({ id: 23, epic })}
        selected={false}
        onSelect={onSelect}
        onOpenEpic={onOpenEpic}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'FILE-SHARE' }));
    expect(onOpenEpic).toHaveBeenCalledWith(epic.id);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects the card when the title is pressed', async () => {
    const onSelect = vi.fn();
    render(
      <Card
        card={makeCard({ id: 24, title: 'Plain', epic })}
        selected={false}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByText('Plain'));
    expect(onSelect).toHaveBeenCalledWith(24);
  });
});
