import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AcceptanceProgress } from '../../src/components/acceptance/AcceptanceProgress';
import { selectLocale } from '../../src/i18n';
import { makeCard } from '../fixtures';

beforeEach(() => selectLocale('en'));

const item = (id: string, done: boolean) => ({ id, text: `text ${id}`, done });

describe('AcceptanceProgress', () => {
  it('shows nothing for a card without conditions', () => {
    const { container } = render(<AcceptanceProgress card={makeCard({ id: 1, acceptance: [] })} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the number done out of the total', () => {
    render(
      <AcceptanceProgress
        card={makeCard({
          id: 1,
          acceptance: [item('AC-1', true), item('AC-2', false), item('AC-3', true)],
        })}
      />,
    );
    expect(screen.getByText('2/3')).toBeTruthy();
    expect(screen.getByTitle('Acceptance conditions 2 / 3')).toBeTruthy();
  });

  it('marks a card whose conditions are all done', () => {
    const { container } = render(
      <AcceptanceProgress card={makeCard({ id: 1, acceptance: [item('AC-1', true)] })} />,
    );
    expect(container.querySelector('[data-complete="true"]')).toBeTruthy();
  });

  it('says that the conditions cannot be read when the frontmatter has a defect', () => {
    render(
      <AcceptanceProgress card={makeCard({ id: 1, acceptance: [], acceptanceError: true })} />,
    );
    expect(screen.getByText('Unreadable')).toBeTruthy();
  });
});
