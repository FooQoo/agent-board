import { describe, expect, it } from 'vitest';
import { CODE_HIGHLIGHT_COLORS } from '../../src/shared/rich-editor/codeHighlight';

describe('code block highlighting', () => {
  it('colors tokens only with the page tokens, so it follows the theme and keeps its contrast', () => {
    expect(CODE_HIGHLIGHT_COLORS.length).toBeGreaterThan(0);
    for (const color of CODE_HIGHLIGHT_COLORS) {
      expect(color).toMatch(/^var\(--r-(text|text2|pend-tx)\)$/);
    }
  });
});
