import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MonitorConditionsDock } from '../../src/monitor/components/MonitorConditionsDock';
import { selectLocale } from '../../src/i18n';

beforeEach(() => selectLocale('en'));

describe('MonitorConditionsDock', () => {
  it('shows nothing for a card without conditions', () => {
    const { container } = render(<MonitorConditionsDock acceptance={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('starts folded at the bottom with the count, and lists each condition when opened', () => {
    const { container } = render(
      <MonitorConditionsDock
        acceptance={[
          { id: 'AC-1', text: 'First', done: true },
          { id: 'AC-2', text: 'Second', done: false },
        ]}
      />,
    );
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toMatch(/1.*2/);
    details.open = true;
    expect(screen.getByRole('checkbox', { name: 'First' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'First' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });
});
