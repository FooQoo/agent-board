import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redirectForInitialViewport } from '../../src/app/access/routing';

describe('shared access entry', () => {
  it.each([
    [767, '/monitor/'],
    [768, '/board/'],
  ])('routes an initial %i CSS-pixel viewport to %s', (width, expected) => {
    const destinations: string[] = [];
    redirectForInitialViewport(width, '/?project=abc#card', (url) => destinations.push(url));
    expect(destinations).toEqual([`${expected}?project=abc#card`]);
  });

  it('uses a fixed internal destination even if the current origin is external', () => {
    const destinations: string[] = [];
    const externalUrl = ['https:', '', 'example.invalid', 'path?project=abc#card'].join('/');
    redirectForInitialViewport(360, externalUrl, (url) => destinations.push(url));
    expect(destinations).toEqual(['/monitor/?project=abc#card']);
  });

  it('keeps a fixed fallback and a token-free, viewport-aware access document', () => {
    const html = readFileSync(resolve('access.html'), 'utf8');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('href="/board/"');
    expect(html).toContain('href="/monitor/"');
    expect(html).not.toContain('agboard-token');
    expect(html).toContain('/src/app/access/entry.ts');
  });

  it('does not subscribe to resize or history changes', () => {
    const source = readFileSync(resolve('src/app/access/entry.ts'), 'utf8');
    expect(source).not.toMatch(/addEventListener\s*\(\s*['"](?:resize|change)['"]/);
    expect(source).toContain('location.replace');
  });
});
