import { describe, expect, it } from 'vitest';
import { activeOutlineIndex, outlineOf } from '../../src/shared/rich-editor/outline';

describe('outlineOf', () => {
  it('is empty without a heading', () => {
    expect(outlineOf('')).toEqual([]);
    expect(outlineOf('Just text\n\n- a list')).toEqual([]);
  });

  it('lists the ## headings with their text and offset', () => {
    const source = '## First\n\ntext\n\n## Second  \n';
    expect(outlineOf(source)).toEqual([
      { text: 'First', from: 0 },
      { text: 'Second', from: source.indexOf('## Second') },
    ]);
  });

  it('ignores ## inside a fenced code block', () => {
    const source = '## Real\n\n```md\n## Not a heading\n```\n\n## After';
    expect(outlineOf(source).map((item) => item.text)).toEqual(['Real', 'After']);
  });

  it('does not list ### or # headings', () => {
    const source = '# Top\n\n### Deep\n\n## Only';
    expect(outlineOf(source)).toEqual([{ text: 'Only', from: source.indexOf('## Only') }]);
  });

  it('strips a closing run of # and reads an underlined heading', () => {
    expect(outlineOf('## Closed ##\n\nUnderlined\n---------').map((item) => item.text)).toEqual([
      'Closed',
      'Underlined',
    ]);
  });

  it('follows the text as it changes', () => {
    expect(outlineOf('## A').map((item) => item.text)).toEqual(['A']);
    expect(outlineOf('## A\n## B').map((item) => item.text)).toEqual(['A', 'B']);
    expect(outlineOf('## A\n').map((item) => item.text)).toEqual(['A']);
  });
});

describe('activeOutlineIndex', () => {
  const items = [
    { text: 'A', from: 0 },
    { text: 'B', from: 20 },
  ];
  it('is the last heading at or before the position', () => {
    expect(activeOutlineIndex(items, 0)).toBe(0);
    expect(activeOutlineIndex(items, 19)).toBe(0);
    expect(activeOutlineIndex(items, 20)).toBe(1);
    expect(activeOutlineIndex(items, 500)).toBe(1);
  });
  it('is -1 before the first heading or without headings', () => {
    expect(activeOutlineIndex([{ text: 'A', from: 5 }], 2)).toBe(-1);
    expect(activeOutlineIndex([], 3)).toBe(-1);
  });
});
