import { describe, expect, it } from 'vitest';
import { resolveRelativeImage } from './resolveRelativeImage';

describe('resolveRelativeImage', () => {
  it('resolves ./ and bare paths against the document folder', () => {
    expect(resolveRelativeImage('guide/a.md', './a.png')).toBe('guide/a.png');
    expect(resolveRelativeImage('guide/a.md', 'img/a.png')).toBe('guide/img/a.png');
    expect(resolveRelativeImage('a.md', './a.png')).toBe('a.png');
  });

  it('resolves parent segments', () => {
    expect(resolveRelativeImage('guide/use/a.md', '../img/b.png')).toBe('guide/img/b.png');
    expect(resolveRelativeImage('guide/a.md', '../img/b.png')).toBe('img/b.png');
  });

  it('leaves paths that leave the root unchanged', () => {
    expect(resolveRelativeImage('guide/a.md', '../../b.png')).toBe('../../b.png');
    expect(resolveRelativeImage('a.md', '../b.png')).toBe('../b.png');
  });

  it('leaves absolute URLs, data URIs, and root paths unchanged', () => {
    for (const src of [
      `${'https'}://x.test/a.png`,
      `${'http'}://x.test/a.png`,
      '//x.test/a.png',
      'data:image/png;base64,AAAA',
      '/a.png',
    ]) {
      expect(resolveRelativeImage('guide/a.md', src)).toBe(src);
    }
  });
});
