const INK_LIGHT = '#FFFFFF';
const INK_DARK = '#1A1A1A';

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#RRGGBB` color (WCAG 2.x). */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colors. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The text color for a label on an epic color: whichever of white or the dark ink contrasts more. */
export function epicInk(color: string): string {
  return contrastRatio(color, INK_LIGHT) >= contrastRatio(color, INK_DARK) ? INK_LIGHT : INK_DARK;
}
