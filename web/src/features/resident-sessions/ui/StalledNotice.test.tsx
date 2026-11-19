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
            { kind: 'request', id: 'Q-3', attempts: 3, lastError: 'boom' },
            { kind: 'answer', id: 'Q-5', attempts: 3, lastError: null },
            { kind: 'task', id: '12', attempts: 3, lastError: null },
          ],
        })}
      />,
    );
    expect(screen.getByText('Request Q-3')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('Answer to Q-5')).toBeTruthy();
    expect(screen.getByText('Task #12')).toBeTruthy();
  });

  it('draws nothing without stalled items', () => {
    const { container } = render(<StalledNotice health={health({})} />);
    expect(container.innerHTML).toBe('');
  });
});
