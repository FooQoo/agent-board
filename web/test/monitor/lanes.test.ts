import { describe, expect, it } from 'vitest';
import {
  actionsWidth,
  cardOffset,
  cardSettles,
  ARM_TOLERANCE,
  withinArmTolerance,
  laneIndex,
  neighbourLane,
  swipeActions,
} from '../../src/pages/monitor/model/lanes';

describe('lane order', () => {
  it('finds the neighbour of a lane, and none past the ends', () => {
    expect(laneIndex('doing')).toBe(1);
    expect(neighbourLane('todo', 1)).toBe('doing');
    expect(neighbourLane('doing', -1)).toBe('todo');
    expect(neighbourLane('done', 1)).toBeNull();
    expect(neighbourLane('todo', -1)).toBeNull();
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
