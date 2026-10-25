import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from './frontmatter';

describe('splitFrontmatter', () => {
  it('splits a --- block from the body', () => {
    const source = '---\ntitle: A\n---\n# Body\n';
    expect(splitFrontmatter(source)).toEqual({
      frontmatter: '---\ntitle: A\n---\n',
      body: '# Body\n',
    });
  });

  it('closes on a ... line', () => {
    expect(splitFrontmatter('---\na: 1\n...\nbody')).toEqual({
      frontmatter: '---\na: 1\n...\n',
      body: 'body',
    });
  });

  it('handles a block that ends the file', () => {
    expect(splitFrontmatter('---\na: 1\n---')).toEqual({ frontmatter: '---\na: 1\n---', body: '' });
  });

  it('returns no frontmatter when unclosed', () => {
    const source = '---\na: 1\nbody';
    expect(splitFrontmatter(source)).toEqual({ frontmatter: '', body: source });
  });

  it('returns no frontmatter for CRLF', () => {
    const source = '---\r\na: 1\r\n---\r\nbody';
    expect(splitFrontmatter(source)).toEqual({ frontmatter: '', body: source });
  });

  it('returns no frontmatter with a leading blank line', () => {
    const source = '\n---\na: 1\n---\nbody';
    expect(splitFrontmatter(source)).toEqual({ frontmatter: '', body: source });
  });

  it('returns no frontmatter for plain text and empty input', () => {
    expect(splitFrontmatter('# Hi')).toEqual({ frontmatter: '', body: '# Hi' });
    expect(splitFrontmatter('')).toEqual({ frontmatter: '', body: '' });
  });

  it('keeps frontmatter + body identical to the source', () => {
    for (const source of [
      '---\na\n---\nx',
      '---\na\n...\n',
      '---\n---\n',
      '---\na',
      'x\n---\ny\n---\n',
    ]) {
      const { frontmatter, body } = splitFrontmatter(source);
      expect(frontmatter + body).toBe(source);
    }
  });
});
