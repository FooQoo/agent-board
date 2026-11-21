/** The smallest and largest zoom of an enlarged picture: 1 is the picture fitted to the view. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
/** The zoom a double tap goes to from 1x. */
export const DOUBLE_TAP_SCALE = 2.5;
/** How long (ms) and how far (px) apart two taps may be to count as a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP = 30;
/** Within this of 1x, a zoom counts as not zoomed, so tiny drift does not leave the picture zoomed. */
const SNAP_EPSILON = 0.01;

export interface Point {
  x: number;
  y: number;
}

/** A zoom and the picture's offset from where it sits at 1x (in px, after scaling about its center). */
export interface ZoomState {
  scale: number;
  tx: number;
  ty: number;
}

/** What the zoom needs to know about the layout: the picture's unscaled box and the visible box. */
export interface ZoomFrame {
  /** The unscaled picture: its size and the position of its center in the visible box. */
  imgW: number;
  imgH: number;
  cx: number;
  cy: number;
  /** The visible box. */
  viewW: number;
  viewH: number;
}

export const IDENTITY: ZoomState = { scale: 1, tx: 0, ty: 0 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clampAxis(offset: number, size: number, view: number, center: number): number {
  const half = size / 2;
  const a = view - half - center;
  const b = half - center;
  // A picture larger than the view covers it; a smaller one stays inside it.
  return size >= view ? Math.min(Math.max(offset, a), b) : Math.min(Math.max(offset, b), a);
}

/** Keeps the zoomed picture over the visible box: no empty gap shows beside a picture that fills it. */
export function clampPan(state: ZoomState, frame: ZoomFrame): ZoomState {
  if (state.scale <= 1 + SNAP_EPSILON) return IDENTITY;
  return {
    scale: state.scale,
    tx: clampAxis(state.tx, frame.imgW * state.scale, frame.viewW, frame.cx),
    ty: clampAxis(state.ty, frame.imgH * state.scale, frame.viewH, frame.cy),
  };
}

/**
 * Changes the zoom to `nextScale` while the point `focus` (in the visible box) stays over the same
 * spot of the picture. The picture scales about its own center.
 */
export function zoomAt(
  state: ZoomState,
  nextScale: number,
  focus: Point,
  frame: ZoomFrame,
): ZoomState {
  const scale = clampScale(nextScale);
  const ratio = scale / state.scale;
  const dx = focus.x - frame.cx;
  const dy = focus.y - frame.cy;
  return clampPan(
    { scale, tx: dx - (dx - state.tx) * ratio, ty: dy - (dy - state.ty) * ratio },
    frame,
  );
}

/** Whether a tap at `now` and `at` follows the previous tap closely enough to make a double tap. */
export function isDoubleTap(
  previous: { time: number; at: Point } | null,
  now: number,
  at: Point,
): boolean {
  return (
    previous !== null &&
    now - previous.time <= DOUBLE_TAP_MS &&
    distance(previous.at, at) <= DOUBLE_TAP_SLOP
  );
}
