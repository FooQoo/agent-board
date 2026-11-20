import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../../../shared/i18n';
import { health } from '../fixtures';
import { StalledNotice } from './StalledNotice';

afterEach(cleanup);

describe('StalledNotice', () => {
  it('names each item and shows its last error', () => {
    render(
      <StalledNotice
        health={health({
          pushStalled: [
            { kind: 'request', id: 'Q-3', attempts: 3, lastError: 'boom', onHold: false },
            { kind: 'answer', id: 'Q-5', attempts: 3, lastError: null, onHold: false },
            { kind: 'task', id: '12', attempts: 3, lastError: null, onHold: false },
          ],
        })}
      />,
    );
    expect(screen.getByText('Request Q-3')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('Answer to Q-5')).toBeTruthy();
    expect(screen.getByText('Task #12')).toBeTruthy();
  });

  it('shows items on hold as a status with the reason, not as an alert', () => {
    render(
      <StalledNotice
        health={health({
          pushStalled: [{ kind: 'task', id: '583', attempts: 3, lastError: null, onHold: true }],
        })}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Task #583');
    expect(screen.getByText('On hold')).toBeTruthy();
    expect(screen.getByText(/waiting for something only a person can do/)).toBeTruthy();
    expect(screen.queryByText('Some items could not be handled')).toBeNull();
  });

  it('draws nothing without stalled items', () => {
    const { container } = render(<StalledNotice health={health({})} />);
    expect(container.innerHTML).toBe('');
  });
});
