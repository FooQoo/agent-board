import { describe, expect, it } from 'vitest';
import { epicInk, contrastRatio } from '../../src/features/epics/model/epic';

describe('epicInk', () => {
  it('uses white on a dark epic color and dark ink on a light one', () => {
    expect(epicInk('#7C3AED')).toBe('#FFFFFF');
    expect(epicInk('#FDE68A')).toBe('#1A1A1A');
  });

  it('picks the ink with the higher contrast against the color', () => {
    for (const color of ['#0EA5E9', '#22C55E', '#EF4444', '#F59E0B', '#111111', '#F5F5F5']) {
      const ink = epicInk(color);
      const other = ink === '#FFFFFF' ? '#1A1A1A' : '#FFFFFF';
      expect(contrastRatio(color, ink)).toBeGreaterThanOrEqual(contrastRatio(color, other));
    }
  });

  it('keeps the contrast of the chosen ink at least 4.5 to 1 for the palette', () => {
    for (const color of ['#7C3AED', '#0EA5E9', '#22C55E', '#EF4444', '#F59E0B', '#FDE68A']) {
      expect(contrastRatio(color, epicInk(color))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
