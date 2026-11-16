// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  HOLD_TOLERANCE,
  SWIPE_SLOP,
  swipeAxis,
  withinHoldTolerance,
} from '../../src/shared/lib/gesture/sideSwipe';

describe('side swipe', () => {
  it('waits until the press moved past the slop', () => {
    expect(swipeAxis(3, -4)).toBeNull();
    expect(swipeAxis(SWIPE_SLOP, 0)).toBe('x');
  });
  it('tells a sideways swipe from a scroll', () => {
    expect(swipeAxis(-20, 6)).toBe('x');
    expect(swipeAxis(5, 24)).toBe('y');
  });
  it('keeps a hold while the finger stays within the tolerance', () => {
    expect(withinHoldTolerance(3, 3)).toBe(true);
    expect(withinHoldTolerance(HOLD_TOLERANCE + 1, 0)).toBe(false);
  });
  it('lets a press that moves sooner become a swipe before the hold completes', () => {
    expect(HOLD_TOLERANCE).toBeLessThan(SWIPE_SLOP);
  });
});
