export const DEFAULT_WIDTH = 360;
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 560;
export const MIN_LANE_WIDTH = 200;
export const STORAGE_KEY = 'agboard.detailWidth';

export interface LayoutMetrics {
  bodyWidth: number;
  paddingLeft: number;
  paddingRight: number;
  gap: number;
}

/** Returns the stored width only when it is an integer within the allowed range. */
export function parseStoredWidth(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= MIN_WIDTH && value <= MAX_WIDTH ? value : null;
}

/** The widest detail panel that still leaves each of the three lanes MIN_LANE_WIDTH. */
export function maxWidthFor({ bodyWidth, paddingLeft, paddingRight, gap }: LayoutMetrics): number {
  return bodyWidth - paddingLeft - paddingRight - 2 * gap - 3 * MIN_LANE_WIDTH;
}

export function clampWidth(width: number, layoutMax: number): number {
  const upper = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, layoutMax));
  return Math.round(Math.min(upper, Math.max(MIN_WIDTH, width)));
}

export function readStoredWidth(): number | null {
  try {
    return parseStoredWidth(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredWidth(width: number): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
    return true;
  } catch {
    return false;
  }
}
