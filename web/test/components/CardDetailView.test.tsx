import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardDetailView } from '../../src/components/detail/CardDetailView';
import { selectLocale } from '../../src/i18n';
import { PROJECT_A, makeCard } from '../fixtures';

describe('CardDetailView', () => {
  beforeEach(() => selectLocale('en'));
  it('renders the shared card body and decision choices as read-only content', async () => {
    const onClose = vi.fn();
    const card = makeCard({
      id: 72,
      title: 'Awaiting API review',
      agentStatus: 'pending',
      pendingReason: 'Which API shape should we use?',
      pendingChoices: [
        { id: 'a', label: 'Keep the current interface' },
        { id: 'b', label: 'Add an adapter' },
      ],
      description: '## Work\nReview the routes.',
    });
    const { container } = render(
      <CardDetailView
        projectId={PROJECT_A.id}
        card={card}
        tab="description"
        onTabChange={vi.fn()}
        onClose={onClose}
        ownerName={PROJECT_A.name}
        statusLabels="monitor"
        attachmentUrl={() => '/monitor/api/attachment'}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Awaiting API review' })).toBeTruthy();
    expect(screen.getByText('Which API shape should we use?')).toBeTruthy();
    expect(screen.getByText('Keep the current interface')).toBeTruthy();
    expect(screen.getByText('Answer on Agent Board from a PC.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /send|edit|archive|delete|answer/i })).toBeNull();
    expect(container.querySelector('.detail__tablist')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps monitor status labels in English when the selected locale is Japanese', () => {
    selectLocale('ja');
    render(
      <CardDetailView
        projectId={PROJECT_A.id}
        card={makeCard({ id: 73, cardStatus: 'done', agentStatus: 'idle' })}
        tab="description"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        statusLabels="monitor"
      />,
    );
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByText('完了')).toBeNull();
    selectLocale('en');
  });
});
