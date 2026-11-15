import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';
import type { Draggable } from '@dnd-kit/dom';
import { describe, expect, it } from 'vitest';
import { cardActivationConstraints } from '../../src/features/tasks/card/cardDrag';

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
