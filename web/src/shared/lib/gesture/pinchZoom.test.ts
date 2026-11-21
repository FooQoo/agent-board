import { describe, expect, it } from 'vitest';
import {
  clampPan,
  clampScale,
  DOUBLE_TAP_MS,
  IDENTITY,
  isDoubleTap,
  MAX_SCALE,
  midpoint,
  pinchTransform,
  type ZoomFrame,
  zoomAt,
} from './pinchZoom';

/** A 300x200 picture centered in a 300x400 view. */
const frame: ZoomFrame = { imgW: 300, imgH: 200, cx: 150, cy: 200, viewW: 300, viewH: 400 };

describe('pinchZoom', () => {
  it('clamps the scale between 1x and the maximum', () => {
    expect(clampScale(0.3)).toBe(1);
    expect(clampScale(2)).toBe(2);
    expect(clampScale(99)).toBe(MAX_SCALE);
  });

  it('zooms about the focus so the spot under the fingers stays put', () => {
    const focus = { x: 250, y: 200 };
    const next = zoomAt(IDENTITY, 2, focus, frame);
    expect(next.scale).toBe(2);
    // The picture point under the focus: (focus - center - t) / scale is unchanged.
    expect((focus.x - frame.cx - next.tx) / 2).toBeCloseTo(focus.x - frame.cx);
  });

  it('never zooms past the maximum', () => {
    expect(zoomAt(IDENTITY, 50, midpoint({ x: 0, y: 0 }, { x: 300, y: 400 }), frame).scale).toBe(
      MAX_SCALE,
    );
  });

  it('returns to the identity at 1x', () => {
    const zoomed = zoomAt(IDENTITY, 3, { x: 250, y: 200 }, frame);
    expect(zoomAt(zoomed, 1, { x: 250, y: 200 }, frame)).toEqual(IDENTITY);
  });

  it('keeps a zoomed picture over the view when panning', () => {
    const state = clampPan({ scale: 2, tx: 9999, ty: -9999 }, frame);
    // 600px wide in a 300px view: at most 150px either way.
    expect(state.tx).toBe(150);
    // 400px tall in a 400px view: no room to move vertically.
    expect(state.ty).toBe(0);
  });

  it('recognises a double tap by time and distance', () => {
    const at = { x: 10, y: 10 };
    expect(isDoubleTap(null, 0, at)).toBe(false);
    expect(isDoubleTap({ time: 0, at }, DOUBLE_TAP_MS, { x: 20, y: 12 })).toBe(true);
    expect(isDoubleTap({ time: 0, at }, DOUBLE_TAP_MS + 1, at)).toBe(false);
    expect(isDoubleTap({ time: 0, at }, 100, { x: 200, y: 10 })).toBe(false);
  });

  it('keeps the picture under the fingers when the pinch midpoint moves', () => {
    const start = { distance: 100, mid: { x: 150, y: 200 }, zoom: IDENTITY };
    // The second finger travels from x=200 to x=400: scale 3, and the midpoint moves from 150 to 250.
    const next = pinchTransform(start, { x: 100, y: 200 }, { x: 400, y: 200 }, frame);
    expect(next.scale).toBeCloseTo(3);
    expect(next.tx).toBeCloseTo(100);
    // The picture point under the starting midpoint is now under the current midpoint.
    expect((250 - frame.cx - next.tx) / next.scale).toBeCloseTo(150 - frame.cx);
  });

  it('matches a fixed-midpoint zoom when the midpoint does not move', () => {
    const start = { distance: 100, mid: { x: 250, y: 200 }, zoom: IDENTITY };
    const next = pinchTransform(start, { x: 200, y: 200 }, { x: 300, y: 200 }, frame);
    expect(next).toEqual(IDENTITY);
    const wider = pinchTransform(start, { x: 150, y: 200 }, { x: 350, y: 200 }, frame);
    expect(wider).toEqual(zoomAt(IDENTITY, 2, { x: 250, y: 200 }, frame));
  });
});
