import { describe, expect, it } from 'vitest';
import {
  actionsWidth,
  canReorder,
  cardOffset,
  cardSettles,
  clampLaneIndex,
  dropSlot,
  LANE_HANDOFF,
  laneHandoff,
  laneIndex,
  neighbourLane,
  reorderBefore,
  reorderIds,
  reorderShifts,
  settleLane,
  swipeActions,
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

const RIGHT = actionsWidth(2);
const LEFT = actionsWidth(1);

describe('card swipe', () => {
  it('offers the lane on the right and the archive to the left, the lane on the left to the right', () => {
    expect(swipeActions('todo')).toEqual({ left: [], right: ['doing', 'archive'] });
    expect(swipeActions('doing')).toEqual({ left: ['todo'], right: ['done', 'archive'] });
    expect(swipeActions('done')).toEqual({ left: ['doing'], right: ['archive'] });
    expect(actionsWidth(0)).toBe(0);
  });
  it('follows the finger between the two sides, and gives past them', () => {
    expect(cardOffset(0, -40, LEFT, RIGHT)).toBe(-40);
    expect(cardOffset(-RIGHT, 30, LEFT, RIGHT)).toBe(-RIGHT + 30);
    expect(cardOffset(0, 40, LEFT, RIGHT)).toBe(40);
    expect(cardOffset(0, LEFT + 40, LEFT, RIGHT)).toBe(LEFT + 10);
    expect(cardOffset(0, -RIGHT - 40, LEFT, RIGHT)).toBe(-RIGHT - 10);
    expect(cardOffset(0, 40, 0, RIGHT)).toBe(10);
  });
  it('stays open on the side it passed half of, or was flicked to', () => {
    expect(cardSettles(-RIGHT / 2 - 1, 0, LEFT, RIGHT)).toBe('right');
    expect(cardSettles(-10, 0, LEFT, RIGHT)).toBeNull();
    expect(cardSettles(-10, -0.9, LEFT, RIGHT)).toBe('right');
    expect(cardSettles(-RIGHT, 0.9, LEFT, RIGHT)).toBeNull();
    expect(cardSettles(LEFT / 2 + 1, 0, LEFT, RIGHT)).toBe('left');
    expect(cardSettles(10, 0.9, LEFT, RIGHT)).toBe('left');
    expect(cardSettles(10, 0.9, 0, RIGHT)).toBeNull();
  });
});

describe('reorder', () => {
  it('reorders every lane but 完了', () => {
    expect(canReorder('todo')).toBe(true);
    expect(canReorder('doing')).toBe(true);
    expect(canReorder('done')).toBe(false);
  });
  it('finds the slot under the held card', () => {
    expect(dropSlot([50, 150, 250], 10)).toBe(0);
    expect(dropSlot([50, 150, 250], 200)).toBe(2);
    expect(dropSlot([50, 150, 250], 300)).toBe(3);
  });
  it('names the card it lands before, and nothing when it stays', () => {
    expect(reorderIds([1, 2, 3], 1, 2)).toEqual([2, 3, 1]);
    expect(reorderBefore([1, 2, 3], 1, 1)).toBe(3);
    expect(reorderBefore([1, 2, 3], 1, 2)).toBeNull();
    expect(reorderBefore([1, 2, 3], 3, 0)).toBe(1);
    expect(reorderBefore([1, 2, 3], 2, 1)).toBeUndefined();
  });
  it('makes room for the held card where it would land', () => {
    const shifts = reorderShifts([1, 2, 3], [0, 60, 140], [50, 70, 40], 1, 1);
    expect(shifts.get(2)).toBe(-60);
    expect(shifts.get(1)).toBe(80);
    expect(shifts.get(3)).toBe(0);
  });
});

describe('a card pulled past its tiles', () => {
  it('hands the pull to the lanes once it is well past them', () => {
    expect(laneHandoff(0, -100, 64, 120)).toBeNull();
    expect(laneHandoff(0, -(120 + LANE_HANDOFF) - 1, 64, 120)).toBe(-(120 + LANE_HANDOFF));
    expect(laneHandoff(0, 64 + LANE_HANDOFF + 1, 64, 120)).toBe(64 + LANE_HANDOFF);
    // A side with no tiles hands over after the give alone.
    expect(laneHandoff(0, LANE_HANDOFF + 1, 0, 120)).toBe(LANE_HANDOFF);
    // An open card counts from where it rests.
    expect(laneHandoff(-120, -LANE_HANDOFF - 1, 64, 120)).toBe(-(120 + LANE_HANDOFF));
  });
});
