import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusLabel } from '../../src/components/StatusLabel';

afterEach(cleanup);

const label = (container: HTMLElement) => container.querySelector('.status-label') as HTMLElement;

describe('StatusLabel', () => {
  it.each([
    ['card', 'todo', 'outline', null],
    ['card', 'doing', 'default', null],
    ['card', 'done', 'secondary', 'lucide-check'],
    ['agent', 'idle', 'muted', null],
    ['agent', 'running', 'secondary', 'lucide-loader'],
    ['agent', 'pending', 'pending', 'lucide-pause'],
  ] as const)('shows %s %s as the %s badge with its icon', (kind, status, variant, icon) => {
    const { container } = render(<StatusLabel kind={kind} status={status} />);
    const badge = label(container);
    expect(badge.getAttribute('data-slot')).toBe('badge');
    expect(badge.getAttribute('data-variant')).toBe(variant);
    expect(badge.classList.contains(`status-label--${kind}`)).toBe(true);
    expect(badge.classList.contains(`status-label--${status}`)).toBe(true);
    const svgs = badge.querySelectorAll('svg');
    expect(svgs).toHaveLength(icon ? 1 : 0);
    if (icon) {
      expect(svgs[0]?.classList.contains(icon)).toBe(true);
      expect(svgs[0]?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('marks only the running loader as spinning so that the board task can animate it', () => {
    const { container } = render(<StatusLabel kind="agent" status="running" />);
    expect(container.querySelector('svg.spinner')).not.toBeNull();
  });
});
