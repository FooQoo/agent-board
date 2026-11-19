import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useTabFlick } from './tabSwipe';

const TABS = ['a', 'b', 'c'] as const;

function Panel({ start = 'b' as (typeof TABS)[number] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(start);
  const flick = useTabFlick(TABS, tab, setTab);
  return (
    <div data-testid="panel" {...flick}>
      <p>{tab}</p>
      <button type="button">control</button>
    </div>
  );
}

function swipe(target: Element, dx: number, dy = 0, pointerType = 'touch') {
  fireEvent.pointerDown(target, { clientX: 200, clientY: 200, pointerType, isPrimary: true });
  fireEvent.pointerMove(target, { clientX: 200 + dx, clientY: 200 + dy, pointerType });
  fireEvent.pointerUp(target, { clientX: 200 + dx, clientY: 200 + dy, pointerType });
}

describe('useTabFlick', () => {
  it('moves to the next tab on a flick to the left and back on a flick to the right', () => {
    render(<Panel />);
    swipe(screen.getByText('b'), -80);
    expect(screen.getByText('c')).toBeTruthy();
    swipe(screen.getByText('c'), 80);
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('stays at the ends', () => {
    render(<Panel start="c" />);
    swipe(screen.getByText('c'), -80);
    expect(screen.getByText('c')).toBeTruthy();
  });

  it('ignores a short move, a vertical scroll, a mouse, and a press on a control', () => {
    render(<Panel />);
    swipe(screen.getByText('b'), -20);
    swipe(screen.getByText('b'), -60, 120);
    swipe(screen.getByText('b'), -80, 0, 'mouse');
    swipe(screen.getByRole('button'), -80);
    expect(screen.getByText('b')).toBeTruthy();
  });
});
