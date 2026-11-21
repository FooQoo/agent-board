import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../src/pages/board/ui/Board';
import type { ProjectId, TaskSummary } from '../src/shared/api/contracts';
import '../src/shared/i18n';

const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90' as ProjectId;
const B = 'b1b2c3d4e5f60718293a4b5c6d7e8f90' as ProjectId;

function backlogCard(id: number): TaskSummary {
  return {
    id,
    title: `Card ${id}`,
    assignee: 'ai',
    taskStatus: 'backlog',
    taskStatusChangedAt: '',
    position: id,
    agentStatus: 'idle',
    agentStatusChangedAt: '',
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    openQuestionIds: [],
    epic: null,
    updatedAt: '',
    draft: null,
    acceptance: { done: 0, total: 0 },
  };
}

function board(projectId: ProjectId) {
  return (
    <Board
      message={null}
      tasks={[backlogCard(7)]}
      selectedId={null}
      onSelect={() => {}}
      onRetry={() => {}}
      onMove={() => {}}
      onSend={() => false}
      projectId={projectId}
    />
  );
}

describe('Board Backlog selection', () => {
  it('starts over when the project changes, even if a card of the same number is there', () => {
    const view = render(board(A));
    fireEvent.click(screen.getByRole('button', { name: 'Select cards to send to Todo' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select #7' }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    view.rerender(board(B));
    expect(screen.queryByText('1 selected')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select cards to send to Todo' })).toBeTruthy();
  });
});
