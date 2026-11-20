import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';
import type { Draggable } from '@dnd-kit/dom';
import { describe, expect, it, vi } from 'vitest';
import {
  cardActivationConstraints,
  dropPlacement,
} from '../../src/shared/lib/gesture/sortableDrag';

// The placement asks the library whether a node is sortable; the test's stand-ins say so by shape.
vi.mock('@dnd-kit/dom/sortable', () => ({
  isSortable: (value: unknown) =>
    typeof value === 'object' && value !== null && 'sortable' in value,
}));

const source = { handle: undefined, element: document.body } as unknown as Draggable;

function press(pointerType: string, target: Element): PointerEvent {
  return { pointerType, target, defaultPrevented: false } as unknown as PointerEvent;
}

function grip(): { grip: Element; inner: Element; body: Element } {
  const card = document.createElement('div');
  card.innerHTML = '<span class="card__grip"><svg></svg></span><span class="card__id">#1</span>';
  return {
    grip: card.querySelector('.card__grip') as Element,
    inner: card.querySelector('svg') as Element,
    body: card.querySelector('.card__id') as Element,
  };
}

describe('card drag activation', () => {
  it('lets a finger on the grip drag at once', () => {
    const { grip: g, inner } = grip();
    expect(cardActivationConstraints(press('touch', g), source)).toBeUndefined();
    expect(cardActivationConstraints(press('touch', inner), source)).toBeUndefined();
  });

  it('asks a finger elsewhere on the card for a short hold', () => {
    const result = cardActivationConstraints(press('touch', grip().body), source);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toBeInstanceOf(PointerActivationConstraints.Delay);
    expect(result?.[0]).toMatchObject({ options: { value: 100, tolerance: 10 } });
  });

  it('leaves the mouse and the pen to the library defaults', () => {
    for (const type of ['mouse', 'pen']) {
      const event = press(type, grip().body);
      const expected = PointerSensor.defaults.activationConstraints;
      const want = typeof expected === 'function' ? expected(event, source) : expected;
      expect(cardActivationConstraints(event, source)).toEqual(want);
    }
  });
});

/** A sortable source or target as the drag library exposes it, with only the parts the placement reads. */
function sortableOf(group: string, initialGroup: string, initialIndex: number, index: number) {
  return {
    sortable: { group, initialGroup, initialIndex, index },
    data: {},
  } as unknown as Draggable;
}
const area = (group: string) => ({ data: { group } }) as never;

describe('drop placement', () => {
  it('reads a move the library already made into another group', () => {
    const source = sortableOf('b', 'a', 0, 2);
    expect(dropPlacement({ source, target: area('b') })).toEqual({
      fromGroup: 'a',
      group: 'b',
      index: 2,
      unchanged: false,
    });
  });

  it('reads a reorder inside the group, and no change as unchanged', () => {
    expect(dropPlacement({ source: sortableOf('a', 'a', 0, 2), target: area('a') })).toMatchObject({
      group: 'a',
      index: 2,
      unchanged: false,
    });
    expect(
      dropPlacement({ source: sortableOf('a', 'a', 1, 1), target: area('a') })?.unchanged,
    ).toBe(true);
  });

  it('sends a card dropped on another group, which the library did not move, to its end', () => {
    expect(dropPlacement({ source: sortableOf('a', 'a', 0, 0), target: area('b') })).toEqual({
      fromGroup: 'a',
      group: 'b',
      index: null,
      unchanged: false,
    });
  });

  it('lets a drop area win over a group the library moved the item into on the way', () => {
    expect(dropPlacement({ source: sortableOf('b', 'a', 0, 1), target: area('new') })).toEqual({
      fromGroup: 'a',
      group: 'new',
      index: null,
      unchanged: false,
    });
  });

  it('returns null with nothing under the drop', () => {
    expect(dropPlacement({ source: sortableOf('a', 'a', 0, 0), target: null })).toBeNull();
  });
});
