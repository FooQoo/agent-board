import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageViewer, type ViewerImage } from './ImageViewer';

const IMAGES: ViewerImage[] = [
  { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: 'First' },
  { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: 'Second' },
];

const slideAt = (position: number): HTMLElement =>
  screen.getAllByRole('group')[position] as HTMLElement;

const scaleOf = (alt: string): number => {
  const raw = screen.getByAltText(alt).getAttribute('data-zoom-scale');
  return raw === null ? 1 : Number(raw);
};

/** Two touch pointers going down at 100px apart, then spreading to `spread`px apart. */
const pinch = (slide: HTMLElement, spread: number) => {
  const touch = { pointerType: 'touch', bubbles: true };
  fireEvent.pointerDown(slide, { ...touch, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerDown(slide, { ...touch, pointerId: 2, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(slide, { ...touch, pointerId: 1, clientX: 150 - spread / 2, clientY: 100 });
  fireEvent.pointerMove(slide, { ...touch, pointerId: 2, clientX: 150 + spread / 2, clientY: 100 });
  fireEvent.pointerUp(slide, { ...touch, pointerId: 1 });
  fireEvent.pointerUp(slide, { ...touch, pointerId: 2 });
};

describe('ImageViewer zoom', () => {
  it('zooms in with a pinch and clamps at the maximum', () => {
    render(<ImageViewer images={IMAGES} index={0} onIndexChange={() => {}} />);
    const slide = slideAt(0);
    pinch(slide, 200);
    expect(scaleOf('First')).toBeCloseTo(2, 1);
    expect(slide.hasAttribute('data-zoomed')).toBe(true);
    pinch(slide, 5000);
    expect(scaleOf('First')).toBe(5);
  });

  it('goes back to 1x with a double click', () => {
    render(<ImageViewer images={IMAGES} index={0} onIndexChange={() => {}} />);
    const slide = slideAt(0);
    fireEvent.doubleClick(slide, { clientX: 10, clientY: 10 });
    expect(scaleOf('First')).toBeGreaterThan(1);
    fireEvent.doubleClick(slide, { clientX: 10, clientY: 10 });
    expect(scaleOf('First')).toBe(1);
    expect(slide.hasAttribute('data-zoomed')).toBe(false);
  });

  it('toggles the zoom with a double tap', () => {
    render(<ImageViewer images={IMAGES} index={0} onIndexChange={() => {}} />);
    const slide = slideAt(0);
    const tap = () => {
      const init = { pointerType: 'touch', pointerId: 7, clientX: 30, clientY: 30 };
      fireEvent.pointerDown(slide, init);
      fireEvent.pointerUp(slide, init);
    };
    tap();
    expect(scaleOf('First')).toBe(1);
    tap();
    expect(scaleOf('First')).toBeGreaterThan(1);
  });

  it('zooms with a trackpad pinch (ctrl + wheel) without zooming the page', () => {
    render(<ImageViewer images={IMAGES} index={0} onIndexChange={() => {}} />);
    const slide = slideAt(0);
    const zoomIn = createEvent.wheel(slide, { ctrlKey: true, deltaY: -50, clientX: 5, clientY: 5 });
    fireEvent(slide, zoomIn);
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(scaleOf('First')).toBeGreaterThan(1);
    // A plain wheel still scrolls.
    const plain = createEvent.wheel(slide, { deltaY: 50 });
    fireEvent(slide, plain);
    expect(plain.defaultPrevented).toBe(false);
  });

  it('keeps the browser from scrolling the page while two fingers are down', () => {
    render(<ImageViewer images={IMAGES} index={0} onIndexChange={() => {}} />);
    const slide = slideAt(0);
    const oneFinger = createEvent.touchMove(slide, { touches: [{ clientX: 1, clientY: 1 }] });
    fireEvent(slide, oneFinger);
    expect(oneFinger.defaultPrevented).toBe(false);
    const twoFingers = createEvent.touchMove(slide, {
      touches: [
        { clientX: 1, clientY: 1 },
        { clientX: 9, clientY: 9 },
      ],
    });
    fireEvent(slide, twoFingers);
    expect(twoFingers.defaultPrevented).toBe(true);
  });

  it('resets to 1x when another picture is shown', () => {
    const { rerender } = render(<ImageViewer images={IMAGES} index={0} onIndexChange={() => {}} />);
    pinch(slideAt(0), 200);
    expect(scaleOf('First')).toBeGreaterThan(1);
    rerender(<ImageViewer images={IMAGES} index={1} onIndexChange={() => {}} />);
    expect(scaleOf('First')).toBe(1);
    expect(scaleOf('Second')).toBe(1);
  });
});
