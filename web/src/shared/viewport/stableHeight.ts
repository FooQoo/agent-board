/**
 * The page height to lay the board and its dialogs out in, kept as `--stable-vh` on the root.
 *
 * A tablet browser can shrink the whole viewport, the small viewport (svh) included, while the
 * software keyboard is open, so the board and an open dialog are squashed into the strip above the
 * keyboard. This keeps the height from before the keyboard opened instead: a shrink while a text
 * field has the focus is the keyboard and is ignored; any other change (a rotation, a resized
 * window, the browser's toolbar) is followed. CSS falls back to svh until this has run.
 */
export function editingText(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement) {
    const nonText = [
      'button',
      'checkbox',
      'color',
      'file',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ];
    return !element.readOnly && !nonText.includes(element.type);
  }
  return false;
}

export interface Viewport {
  width: number;
  height: number;
}

/** The height to keep, given the last kept one and the viewport now. */
export function nextStableHeight(kept: Viewport | null, now: Viewport, typing: boolean): Viewport {
  if (!kept || now.width !== kept.width || now.height >= kept.height || !typing) return now;
  return kept;
}

export function watchStableHeight(target: Window = window): () => void {
  const root = target.document.documentElement;
  let kept: Viewport | null = null;
  const viewport = () => ({ width: target.innerWidth, height: target.innerHeight });
  const typing = () => editingText(target.document.activeElement);
  // While the kept height is taller than the viewport and a text field has the focus, the keyboard
  // covers the bottom of the page; the dialog rule in ui.css fits centered dialogs into the visible
  // area then (using the visual viewport from keyboardInset.ts), so their buttons and text fields
  // stay above it. Without a focused field there is no keyboard, whatever the heights say.
  const mark = () =>
    root.toggleAttribute('data-keyboard', typing() && kept !== null && kept.height > viewport().height);
  const update = () => {
    const next = nextStableHeight(kept, viewport(), typing());
    if (next !== kept) {
      kept = next;
      root.style.setProperty('--stable-vh', `${next.height}px`);
    }
    mark();
  };
  update();
  // A closing keyboard grows the viewport again, which is always followed.
  target.addEventListener('resize', update);
  // The focus leaving a field ends the keyboard layout at once; the kept height waits for the resize.
  target.document.addEventListener('focusin', mark);
  target.document.addEventListener('focusout', mark);
  return () => {
    target.removeEventListener('resize', update);
    target.document.removeEventListener('focusin', mark);
    target.document.removeEventListener('focusout', mark);
  };
}
