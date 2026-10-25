import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/shared/i18n';
import { Drawer } from '../../src/shared/ui/drawer';

const HEIGHT = 400;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(() => {
  selectLocale('en');
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(HEIGHT);
});
afterEach(() => vi.restoreAllMocks());

/** Runs the animation frames that the pointer moves asked for. */
function runFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of pending) callback(0);
  });
}

function Demo({ onBody }: { onBody?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Shut
      </button>
      <Drawer open={open} onOpenChange={setOpen} identity="#1" title="Task">
        <Body onRender={onBody} />
      </Drawer>
    </>
  );
}

function Body({ onRender }: { onRender?: () => void }): ReactNode {
  onRender?.();
  return <p>Body</p>;
}

const handle = () => screen.getByRole('button', { name: 'Swipe down to close details' });
const popup = () => document.querySelector<HTMLElement>('[data-slot="drawer-popup"]');
const overlay = () => document.querySelector<HTMLElement>('[data-slot="drawer-backdrop"]');
const pull = () => popup()?.style.getPropertyValue('--drawer-drag-y') ?? '';

/** jsdom has no PointerEvent: a mouse event with the pointer fields stands in for it. */
function firePointer(
  type: string,
  init: { clientY?: number; timeStamp?: number },
  target: Element = handle(),
) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientY: init.clientY ?? 0 });
  Object.assign(event, { pointerId: 1, isPrimary: true });
  if (init.timeStamp !== undefined)
    Object.defineProperty(event, 'timeStamp', { value: init.timeStamp });
  fireEvent(target, event);
}
// React reports a zero timeStamp as the current time, so the fake clock starts well above zero.
const down = (y: number, time = 1000) =>
  firePointer('pointerdown', { clientY: y, timeStamp: time });
const move = (y: number) => firePointer('pointermove', { clientY: y });
const up = (y: number, time = 2000) => firePointer('pointerup', { clientY: y, timeStamp: time });
const cancel = (y: number) => firePointer('pointercancel', { clientY: y });
const reopen = () => fireEvent.click(screen.getByText('Reopen'));
const shut = () => fireEvent.click(screen.getByText('Shut'));

/** jsdom runs no animations: report an exit animation so that Radix keeps a closing sheet mounted. */
function holdExitAnimation() {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = real(element, pseudo);
    return new Proxy(style, {
      get(target, property) {
        if (property === 'animationName') {
          return element.getAttribute('data-state') === 'closed' ? 'mobile-drawer-out' : 'none';
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
}
const finishExit = () =>
  fireEvent(
    popup() as HTMLElement,
    Object.assign(new Event('animationend', { bubbles: true }), {
      animationName: 'mobile-drawer-out',
    }),
  );

describe('Drawer drag', () => {
  it('drags from the header but leaves the close button to taps', () => {
    render(<Demo />);
    const title = screen.getByText('Task');
    firePointer('pointerdown', { clientY: 100, timeStamp: 1000 }, title);
    firePointer('pointermove', { clientY: 140 }, title);
    runFrames();
    expect(pull()).toBe('40px');
    firePointer('pointercancel', { clientY: 140 }, title);

    const close = screen.getByRole('button', { name: 'Close details' });
    firePointer('pointerdown', { clientY: 100, timeStamp: 3000 }, close);
    firePointer('pointermove', { clientY: 160 }, close);
    runFrames();
    expect(popup()?.hasAttribute('data-swiping')).toBe(false);
  });

  it('follows the pointer once per frame without rendering the body again', () => {
    const onBody = vi.fn();
    render(<Demo onBody={onBody} />);
    const renders = onBody.mock.calls.length;
    down(100);
    move(120);
    move(150);
    move(180);
    expect(frames.size).toBe(1);
    expect(pull()).toBe('');
    runFrames();
    expect(pull()).toBe('80px');
    expect(overlay()?.style.getPropertyValue('--drawer-swipe-progress')).toBe('0.2');
    expect(popup()?.hasAttribute('data-swiping')).toBe(true);
    expect(onBody).toHaveBeenCalledTimes(renders);
  });

  it('measures the sheet once per drag, not on every move', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(HEIGHT);
    render(<Demo />);
    down(0);
    const measured = height.mock.calls.length;
    for (const y of [10, 20, 30, 40]) move(y);
    runFrames();
    up(40, 6000);
    expect(height.mock.calls.length).toBe(measured);
  });

  it('keeps its pull while sliding out, then opens again at rest', async () => {
    holdExitAnimation();
    render(<Demo />);
    down(0);
    move(HEIGHT * 0.3);
    up(HEIGHT * 0.3);
    expect(popup()?.getAttribute('data-state')).toBe('closed');
    expect(popup()?.hasAttribute('data-swiping')).toBe(false);
    expect(pull()).toBe(`${HEIGHT * 0.3}px`);

    // Opening again before the exit ends reuses the sheet, so the pull has to be dropped.
    reopen();
    expect(popup()?.getAttribute('data-state')).toBe('open');
    expect(pull()).toBe('');
    expect(overlay()?.style.getPropertyValue('--drawer-swipe-progress')).toBe('');
  });

  it('opens at rest after a dismissed sheet has gone', () => {
    holdExitAnimation();
    render(<Demo />);
    down(0);
    move(HEIGHT * 0.3);
    up(HEIGHT * 0.3);
    finishExit();
    expect(popup()).toBeNull();
    reopen();
    expect(pull()).toBe('');
    expect(popup()?.getAttribute('data-state')).toBe('open');
  });

  it('dismisses on a quick flick, and returns the sheet when the drag is slow and short', () => {
    holdExitAnimation();
    render(<Demo />);
    down(0);
    move(60);
    up(60, 1050);
    expect(popup()?.getAttribute('data-state')).toBe('closed');
    reopen();
    down(0);
    move(60);
    up(60);
    expect(popup()?.getAttribute('data-state')).toBe('open');
    expect(pull()).toBe('0px');
    expect(popup()?.hasAttribute('data-settling')).toBe(true);
  });

  it('ignores an upward drag', () => {
    render(<Demo />);
    down(200);
    move(100);
    up(100, 1020);
    expect(screen.getByRole('dialog').getAttribute('data-state')).toBe('open');
    expect(pull()).toBe('0px');
    expect(popup()?.hasAttribute('data-settling')).toBe(false);
    expect(popup()?.hasAttribute('data-swiping')).toBe(false);
  });

  it('returns the sheet and keeps it open when the pointer is cancelled', () => {
    render(<Demo />);
    down(0);
    move(HEIGHT * 0.6);
    cancel(HEIGHT * 0.6);
    expect(screen.getByRole('dialog').getAttribute('data-state')).toBe('open');
    expect(pull()).toBe('0px');
    // A lost capture after the end does not end the drag twice.
    firePointer('lostpointercapture', {});
    expect(pull()).toBe('0px');
  });

  it('clears the settling state when the return transition ends', () => {
    render(<Demo />);
    down(0);
    move(40);
    up(40, 3000);
    expect(popup()?.hasAttribute('data-settling')).toBe(true);
    fireEvent(
      popup() as HTMLElement,
      Object.assign(new Event('transitionend', { bubbles: true }), { propertyName: 'translate' }),
    );
    expect(popup()?.hasAttribute('data-settling')).toBe(false);
  });

  it('survives rapid open and close without keeping a pull', async () => {
    holdExitAnimation();
    render(<Demo />);
    down(0);
    move(300);
    up(300);
    for (let index = 0; index < 5; index += 1) {
      reopen();
      shut();
    }
    reopen();
    await waitFor(() => expect(pull()).toBe(''));
    expect(popup()?.getAttribute('data-state')).toBe('open');
  });

  it('stops following the pointer once another action has closed the sheet', () => {
    holdExitAnimation();
    render(<Demo />);
    down(0);
    move(100);
    runFrames();
    shut();
    expect(popup()?.getAttribute('data-state')).toBe('closed');
    expect(popup()?.hasAttribute('data-swiping')).toBe(false);
    move(200);
    expect(frames.size).toBe(0);
    expect(pull()).toBe('100px');
  });
});
