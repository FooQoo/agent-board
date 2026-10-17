import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Lane } from '../../src/components/Lane';
import { fixtureTask } from '../fixtures';

describe('Lane scroll cue', () => {
  it('wraps the tasks in a scroll container reporting overflow via data-more', () => {
    const { container, rerender } = render(
      <Lane column="done" tasks={[fixtureTask(14)]} selectedId={null} onSelect={vi.fn()} />,
    );
    const scroll = container.querySelector('.lane__scroll') as HTMLElement;
    expect(scroll).toBeTruthy();
    expect(scroll.dataset.more).toBe('false');

    const list = container.querySelector('.lane__cards') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 600 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 });
    rerender(
      <Lane
        column="done"
        tasks={[fixtureTask(14), fixtureTask(15)]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(scroll.dataset.more).toBe('true');
  });
});
