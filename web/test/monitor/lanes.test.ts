import { describe, expect, it } from 'vitest';
import {
  EDGE_ZONE,
  REVEAL_WIDTH,
  cardOffset,
  cardSettlesOpen,
  clampLaneIndex,
  dwellEdge,
  edgeOf,
  edgeTarget,
  laneIndex,
  neighbourLane,
  settleLane,
  swipeAxis,
  trackOffset,
  withinLiftTolerance,
} from '../../src/pages/monitor/model/lanes';

describe('lane order', () => {
  it('finds the neighbour of a lane, and none past the ends', () => {
    expect(laneIndex('doing')).toBe(1);
    expect(neighbourLane('todo', 1)).toBe('doing');
    expect(neighbourLane('doing', -1)).toBe('todo');
    expect(neighbourLane('done', 1)).toBeNull();
    expect(neighbourLane('todo', -1)).toBeNull();
  });

  it('keeps an index on the three lanes', () => {
    expect(clampLaneIndex(-0.7)).toBe(0);
    expect(clampLaneIndex(1.4)).toBe(1);
    expect(clampLaneIndex(9)).toBe(2);
  });
});

describe('swipe axis', () => {
  it('waits until the press moved past the slop', () => {
    expect(swipeAxis(3, -4)).toBeNull();
  });
  it('tells a sideways swipe from a scroll', () => {
    expect(swipeAxis(-20, 6)).toBe('x');
    expect(swipeAxis(5, 24)).toBe('y');
  });
  it('lets a finger drift a little while it holds', () => {
    expect(withinLiftTolerance(4, 4)).toBe(true);
    expect(withinLiftTolerance(10, 6)).toBe(false);
  });
});

describe('lane swipe', () => {
  it('changes lane past a quarter of the width', () => {
    expect(settleLane('doing', -120, 0, 390)).toBe('done');
    expect(settleLane('doing', 120, 0, 390)).toBe('todo');
  });
  it('stays for a short, slow drag', () => {
    expect(settleLane('doing', -60, 0.1, 390)).toBe('doing');
  });
  it('changes lane for a quick flick', () => {
    expect(settleLane('todo', -30, -0.8, 390)).toBe('doing');
  });
  it('stays at the ends of the row', () => {
    expect(settleLane('todo', 200, 1, 390)).toBe('todo');
    expect(settleLane('done', -200, -1, 390)).toBe('done');
  });
  it('moves the track with the finger and gives at the ends', () => {
    expect(trackOffset('doing', -50, 390)).toBe(-390 - 50);
    expect(trackOffset('todo', 60, 390)).toBe(20);
    expect(trackOffset('done', -60, 390)).toBe(-780 - 20);
  });
});

describe('card swipe', () => {
  it('follows the finger between closed and fully revealed', () => {
    expect(cardOffset(0, -40)).toBe(-40);
    expect(cardOffset(-REVEAL_WIDTH, 30)).toBe(-REVEAL_WIDTH + 30);
  });
  it('gives past either end', () => {
    expect(cardOffset(0, 40)).toBe(10);
    expect(cardOffset(0, -REVEAL_WIDTH - 40)).toBe(-REVEAL_WIDTH - 10);
  });
  it('settles open past half the button, or on a flick', () => {
    expect(cardSettlesOpen(-REVEAL_WIDTH / 2 - 1, 0)).toBe(true);
    expect(cardSettlesOpen(-10, 0)).toBe(false);
    expect(cardSettlesOpen(-10, -0.9)).toBe(true);
    expect(cardSettlesOpen(-REVEAL_WIDTH, 0.9)).toBe(false);
  });
});

describe('edge of the screen', () => {
  it('finds the strip a pointer is in', () => {
    expect(edgeOf(10, 390)).toBe('left');
    expect(edgeOf(390 - EDGE_ZONE, 390)).toBe('right');
    expect(edgeOf(200, 390)).toBeNull();
  });
  it('asks for the neighbour on that side', () => {
    expect(edgeTarget('todo', 'right')).toBe('doing');
    expect(edgeTarget('doing', 'left')).toBe('todo');
    expect(edgeTarget('todo', 'left')).toBeNull();
    expect(edgeTarget('done', 'right')).toBeNull();
    expect(edgeTarget('doing', null)).toBeNull();
  });
  it('runs the dwell only in a strip that leads somewhere, and once per visit', () => {
    expect(dwellEdge('doing', 'right', true)).toEqual({ edge: 'right', run: true, armed: true });
    expect(dwellEdge('doing', 'right', false)).toEqual({ edge: 'right', run: false, armed: false });
    expect(dwellEdge('todo', 'left', true).run).toBe(false);
    expect(dwellEdge('todo', 'left', true).edge).toBeNull();
    expect(dwellEdge('doing', null, false)).toEqual({ edge: null, run: false, armed: true });
  });
});
