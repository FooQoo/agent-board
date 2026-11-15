import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';
import type { Draggable } from '@dnd-kit/dom';

/** The class of the grip's hit area on a card. A finger that lands on it starts a drag at once. */
export const GRIP_CLASS = 'card__grip';

/** True when the event's target is the grip's hit area or inside it. */
function onGrip(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`.${GRIP_CLASS}`) !== null;
}

/**
 * When a pointer press becomes a drag. A finger on the grip drags at once, because the grip is the
 * place built for dragging. A finger elsewhere on the card must hold for a moment first, so that a
 * quick swipe still scrolls the lane. The library's own rules (mouse and pen) apply to everything else.
 */
export function cardActivationConstraints(event: PointerEvent, source: Draggable) {
  if (event.pointerType === 'touch') {
    if (onGrip(event.target)) return undefined;
    return [new PointerActivationConstraints.Delay({ value: 150, tolerance: 10 })];
  }
  const fallback = PointerSensor.defaults.activationConstraints;
  return typeof fallback === 'function' ? fallback(event, source) : fallback;
}

/** The sensors a board card sorts with. */
export const cardSensors = [
  PointerSensor.configure({ activationConstraints: cardActivationConstraints }),
  KeyboardSensor,
];
