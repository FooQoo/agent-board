import { describe, expect, it } from 'vitest';
import { countItems } from '../../src/lib/markdown/countItems';
import { splitSections } from '../../src/lib/markdown/splitSections';
import { safeImageUrl, safeLinkUrl } from '../../src/lib/markdown/urls';

describe('splitSections', () => {
  it('returns no sections when there is no H2', () => {
    const source = '# Title\n\nText\n\n### Third\n\n- a\n';
    const result = splitSections(source);
    expect(result.sections).toEqual([]);
    expect(result.preamble).toBe(source.trim());
  });

  it('returns nothing for an empty or blank source', () => {
    expect(splitSections('')).toEqual({ preamble: '', sections: [] });
    expect(splitSections('  \n\n')).toEqual({ preamble: '', sections: [] });
  });

  it('splits at every H2 and keeps the text before the first H2 as the preamble', () => {
    const result = splitSections('Intro\n\n## One\n\nbody 1\n\n## Two\n\n- a\n- b\n');
    expect(result.preamble).toBe('Intro');
    expect(result.sections).toEqual([
      { title: 'One', count: 1, markdown: 'body 1' },
      { title: 'Two', count: 2, markdown: '- a\n- b' },
    ]);
  });

  it('starts with a section when the source begins with an H2', () => {
    const result = splitSections('## Only\n\ntext');
    expect(result.preamble).toBe('');
    expect(result.sections).toEqual([{ title: 'Only', count: 1, markdown: 'text' }]);
  });

  it('does not nest H3 and deeper headings under their own section', () => {
    const result = splitSections('## A\n\n### A1\n\ntext\n\n#### A2\n\n## B\n');
    expect(result.sections.map((s) => s.title)).toEqual(['A', 'B']);
    expect(result.sections[0]?.markdown).toBe('### A1\n\ntext\n\n#### A2');
    expect(result.sections[1]?.markdown).toBe('');
  });

  it('does not treat ## inside a code block as a heading', () => {
    const source = '## Real\n\n```md\n## Fake\n```\n\n~~~\n## Fake 2\n~~~\n';
    const result = splitSections(source);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.markdown).toContain('## Fake');
    expect(result.sections[0]?.markdown).toContain('## Fake 2');
  });

  it('does not treat an indented or quoted ## as a section', () => {
    const result = splitSections('## Real\n\n> ## Quoted\n\n    ## Indented\n');
    expect(result.sections).toHaveLength(1);
  });

  it('supports Japanese titles and Setext H2', () => {
    const result = splitSections('## 目的・責務\n\n本文\n\n受け入れ条件\n---\n\n- 一つ\n');
    expect(result.sections.map((s) => s.title)).toEqual(['目的・責務', '受け入れ条件']);
    expect(result.sections[1]?.markdown).toBe('- 一つ');
  });

  it('uses the plain text of a heading with inline formatting as the title', () => {
    const result = splitSections('## Use `agboard init` and **bold**\n\nx');
    expect(result.sections[0]?.title).toBe('Use agboard init and bold');
  });

  it('handles CRLF line endings', () => {
    const result = splitSections('Pre\r\n\r\n## A\r\n\r\n- x\r\n- y\r\n\r\n## B\r\n\r\ntext\r\n');
    expect(result.preamble).toBe('Pre');
    expect(result.sections).toEqual([
      { title: 'A', count: 2, markdown: '- x\n- y' },
      { title: 'B', count: 1, markdown: 'text' },
    ]);
  });
});

describe('countItems', () => {
  it('counts list items, including nested and task items', () => {
    expect(countItems('- a\n  - b\n  - c\n- d')).toBe(4);
    expect(countItems('- [x] a\n- [ ] b\n- [ ] c')).toBe(3);
    expect(countItems('1. a\n2. b\n3. c')).toBe(3);
  });

  it('counts the items of every list in the section', () => {
    expect(countItems('- a\n- b\n\ntext\n\n1. c')).toBe(3);
  });

  it('counts blocks when there is no list', () => {
    expect(countItems('One paragraph.')).toBe(1);
    expect(countItems('First\n\nSecond\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```')).toBe(
      4,
    );
  });

  it('does not count headings as blocks', () => {
    expect(countItems('### Sub\n\ntext')).toBe(1);
  });

  it('is zero for an empty section', () => {
    expect(countItems('')).toBe(0);
  });

  it('does not count list-like lines inside code', () => {
    expect(countItems('```\n- a\n- b\n```')).toBe(1);
  });
});

describe('safeLinkUrl / safeImageUrl', () => {
  for (const [name, fn] of [
    ['safeLinkUrl', safeLinkUrl],
    ['safeImageUrl', safeImageUrl],
  ] as const) {
    describe(name, () => {
      it('allows http and https', () => {
        expect(fn('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c');
        expect(fn('https://example.com/x.png')).toBe('https://example.com/x.png');
        expect(fn('HTTPS://EXAMPLE.com/')).toBe('HTTPS://EXAMPLE.com/');
      });

      it('rejects other schemes', () => {
        for (const url of [
          'javascript:alert(1)',
          'JaVaScRiPt:alert(1)',
          'data:image/png;base64,AAAA',
          'file:///etc/passwd',
          'ftp://example.com/',
          'mailto:a@example.com',
          'vbscript:x',
        ]) {
          expect(fn(url), url).toBeNull();
        }
      });

      it('rejects relative, protocol-relative and empty values', () => {
        for (const url of [
          '//example.com/a',
          '/a/b.png',
          'a/b.png',
          './a',
          '#top',
          '',
          'example.com',
        ]) {
          expect(fn(url), url).toBeNull();
        }
      });

      it('rejects whitespace and control characters anywhere', () => {
        for (const url of [
          ' https://example.com/',
          'https://example.com/ ',
          '\thttps://example.com/',
          '\u0000https://example.com/',
          'java\nscript:alert(1)',
          'https://exa\tmple.com/',
          'https://example.com/a b',
          'https://example.com/\u007f',
        ]) {
          expect(fn(url), JSON.stringify(url)).toBeNull();
        }
      });

      it('rejects a missing host', () => {
        expect(fn('https://')).toBeNull();
        expect(fn('http:///path')).toBeNull();
        expect(fn('https:example.com')).toBeNull();
      });
    });
  }
});
