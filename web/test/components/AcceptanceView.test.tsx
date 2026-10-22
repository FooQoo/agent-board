import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderDetail } from '../renderDetail';
import { beforeEach, describe, expect, it } from 'vitest';
import { AcceptanceView } from '../../src/features/tasks/acceptance/AcceptanceView';
import { DetailPanel } from '../../src/features/tasks/detail/DetailPanel';
import { selectLocale } from '../../src/shared/i18n';
import { PROJECT_A, makeTask } from '../fixtures';

beforeEach(() => selectLocale('en'));

const item = (n: number, done: boolean) => ({ id: `AC-${n}`, text: `Condition ${n}`, done });

describe('AcceptanceView', () => {
  it('lists each condition with its ID and shows the count, read-only', () => {
    const { container } = render(<AcceptanceView items={[item(1, true), item(2, false)]} />);
    expect(screen.getByText('Acceptance conditions')).toBeTruthy();
    expect(screen.getByText('AC-1')).toBeTruthy();
    expect(screen.getByText('Condition 2')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    boxes.forEach((box) => {
      expect((box as HTMLInputElement).disabled).toBe(true);
    });
  });

  it('shows at most six conditions and opens the rest with a button', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(i + 1, false));
    render(<AcceptanceView items={items} />);
    expect(screen.queryByText('Condition 6')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all (8)' }));
    expect(screen.getByText('Condition 8')).toBeTruthy();
  });

  it('renders nothing without conditions', () => {
    const { container } = render(<AcceptanceView items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('unreadable conditions in the detail body', () => {
  it('says that the conditions cannot be read and that the body is shown', async () => {
    const task = makeTask({
      id: 12,
      title: 'Task',
      description: '---\nacceptance:\n  - id: AC-1\n    text: \n---\n\nBody below\n',
      body: '---\nacceptance:\n  - id: AC-1\n    text: \n---\n\nBody below\n',
      acceptanceError: true,
    });
    renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={task}
        problems={[]}
        onClose={() => {}}
        onRemove={async () => true}
      />,
    );
    expect(
      within(screen.getByRole('tabpanel')).getByText('Acceptance conditions cannot be read'),
    ).toBeTruthy();
    expect(await screen.findByText(/Body below/)).toBeTruthy();
    expect(screen.queryByText('0 / 1')).toBeNull();
  });
});

describe('DetailPanel body', () => {
  it('shows the body without the frontmatter and the conditions above it', async () => {
    const task = makeTask({
      id: 12,
      title: 'Task',
      description:
        '---\nacceptance:\n  - id: AC-1\n    text: Works\n    done: false\n---\n\nBody only\n',
      body: 'Body only\n',
      acceptance: [item(1, false)],
    });
    renderDetail(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={task}
        problems={[]}
        onClose={() => {}}
        onRemove={async () => true}
      />,
    );
    expect(await screen.findByText('Body only')).toBeTruthy();
    expect(screen.queryByText(/acceptance:/)).toBeNull();
    expect(within(screen.getByRole('tabpanel')).queryByText('Condition 1')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Conditions' }));
    expect(await within(screen.getByRole('tabpanel')).findByText('Condition 1')).toBeTruthy();
  });
});
