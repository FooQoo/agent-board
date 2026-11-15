/**
 * Whether the main pointer is a finger. A dialog does not focus a text field when it opens there,
 * because focusing it would raise the software keyboard over the dialog before it is read.
 */
export function isTouchScreen(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
