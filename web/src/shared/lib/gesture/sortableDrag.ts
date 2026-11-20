import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';
import type { Draggable, Droppable } from '@dnd-kit/dom';
import { isSortable } from '@dnd-kit/dom/sortable';

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
    return [new PointerActivationConstraints.Delay({ value: 100, tolerance: 10 })];
  }
  const fallback = PointerSensor.defaults.activationConstraints;
  return typeof fallback === 'function' ? fallback(event, source) : fallback;
}

/** The sensors a sortable card (a board card, a task of a wave) uses. */
export const cardSensors = [
  PointerSensor.configure({ activationConstraints: cardActivationConstraints }),
  KeyboardSensor,
];

/** Where a finished drag puts its item. */
export interface DropPlacement {
  /** The group the item came from. */
  fromGroup: string;
  /** The group it was dropped in. */
  group: string;
  /**
   * Where it goes among the other items of `group` (the list without the dragged item): `index`
   * items stay before it. `null` means the end: it was dropped on the group itself, or on a card of
   * a group the caller keeps it out of.
   */
  index: number | null;
  /** The item stays where it was: same group, same position. */
  unchanged: boolean;
}

/**
 * Where a finished drag puts its item, for lists that sort cards across groups (the lanes of the
 * board, the waves of an epic). A sortable item names its group in `useSortable({ group })`, and a
 * group's own drop area names it in `data.group`.
 *
 * When the library moved the item into another group while it was dragged (a caller that does not
 * stop `onDragOver`), that group and place are the answer. Otherwise the item is still in its own
 * group, and the target says where it was dropped: a card or the area of the same group is a
 * reorder, another group is a move to the end of it. Returns null when nothing sits under the drop.
 */
export function dropPlacement(operation: {
  source: Draggable | null;
  target: Droppable | null;
}): DropPlacement | null {
  const { source, target } = operation;
  if (!source || !isSortable(source)) return null;
  const { initialIndex, index, initialGroup, group } = source.sortable;
  if (initialGroup === undefined || group === undefined) return null;
  const fromGroup = String(initialGroup);
  if (String(group) !== fromGroup) {
    return { fromGroup, group: String(group), index, unchanged: false };
  }
  if (!target) return null;
  const targetGroup = isSortable(target) ? target.sortable.group : target.data?.group;
  if (targetGroup === undefined || typeof targetGroup === 'object') return null;
  if (String(targetGroup) === fromGroup) {
    return { fromGroup, group: fromGroup, index, unchanged: initialIndex === index };
  }
  return { fromGroup, group: String(targetGroup), index: null, unchanged: false };
}
