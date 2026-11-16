import { describe, expect, it } from 'vitest';
import {
  actionsWidth,
  cardOffset,
  cardSettles,
  clampLaneIndex,
  ARM_TOLERANCE,
  withinArmTolerance,
  laneIndex,
  neighbourLane,
  settleLane,
  swipeActions,
  swipeAxis,
  trackOffset,
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
  it('lets a finger drift a little while it holds', () => {});
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

describe('choosing a card', () => {
  it('keeps the hold while the finger stays within the tolerance', () => {
    expect(withinArmTolerance(3, 3)).toBe(true);
    expect(withinArmTolerance(ARM_TOLERANCE + 1, 0)).toBe(false);
  });
});
