import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AcceptanceView } from '../../src/components/acceptance/AcceptanceView';
import { DetailPanel } from '../../src/components/DetailPanel';
import { selectLocale } from '../../src/i18n';
import { PROJECT_A, makeCard } from '../fixtures';

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
  it('says that the conditions cannot be read and that the body is shown', () => {
    const card = makeCard({
      id: 12,
      title: 'Card',
      description: '---\nacceptance:\n  - id: AC-1\n    text: \n---\n\nBody below\n',
      body: '---\nacceptance:\n  - id: AC-1\n    text: \n---\n\nBody below\n',
      acceptanceError: true,
    });
    render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={card}
        problems={[]}
        onClose={() => {}}
        onRemove={async () => true}
      />,
    );
    expect(screen.getByText('Acceptance conditions cannot be read')).toBeTruthy();
    expect(screen.getByText(/Body below/)).toBeTruthy();
    expect(screen.queryByText('0 / 1')).toBeNull();
  });
});

describe('DetailPanel body', () => {
  it('shows the body without the frontmatter and the conditions above it', () => {
    const card = makeCard({
      id: 12,
      title: 'Card',
      description:
        '---\nacceptance:\n  - id: AC-1\n    text: Works\n    done: false\n---\n\nBody only\n',
      body: 'Body only\n',
      acceptance: [item(1, false)],
    });
    render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={card}
        problems={[]}
        onClose={() => {}}
        onRemove={async () => true}
      />,
    );
    expect(screen.getByText('Body only')).toBeTruthy();
    expect(screen.queryByText(/acceptance:/)).toBeNull();
    expect(screen.getByText('Condition 1')).toBeTruthy();
  });
});
