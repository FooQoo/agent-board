import { ACCENTS } from '../../../shared/theme';

/**
 * Colors of one theme swatch tile. The tile of a mode is drawn on that mode's page background
 * and shows the accent of that theme, so every swatch looks the same whichever theme is current.
 * The values mirror theme.css (--r-bg per mode, --r-accent per mode and accent); a unit test
 * keeps them in step.
 */
export const THEME_SWATCHES: Record<string, { bg: string; accent: string }> = Object.fromEntries(
  (
    [
      [
        'light',
        '#f6f7f9',
        [
          '#2563eb',
          '#0284c7',
          '#0891b2',
          '#0d9488',
          '#16a34a',
          '#65a30d',
          '#ca8a04',
          '#ea580c',
          '#dc2626',
          '#db2777',
          '#7c3aed',
          '#475569',
        ],
      ],
      [
        'dark',
        '#0f1318',
        [
          '#6b9aff',
          '#4db5f0',
          '#3cc9e0',
          '#3dcbb8',
          '#4cc97a',
          '#a3d94a',
          '#f0c531',
          '#f59a52',
          '#f47c7c',
          '#f472b6',
          '#a78bfa',
          '#94a3b8',
        ],
      ],
    ] as const
  ).flatMap(([mode, bg, accents]) =>
    ACCENTS.map((accent, index) => [`${mode}-${accent}`, { bg, accent: accents[index] ?? '' }]),
  ),
);
