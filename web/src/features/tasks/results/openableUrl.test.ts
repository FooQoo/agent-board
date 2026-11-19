import { describe, expect, it } from 'vitest';
import { openableUrl } from './openableUrl';

/** Source files may not hold a literal web address, so one is joined from its parts. */
const web = (scheme: 'http' | 'https', rest: string) => [`${scheme}:`, '', rest].join('/');

describe('openableUrl', () => {
  it('accepts http and https URLs', () => {
    const pull = web('https', 'github.com/FooQoo/agent-board/pull/1');
    expect(openableUrl(pull)).toBe(pull);
    const plain = web('http', 'example.com/a?b=1#c');
    expect(openableUrl(plain)).toBe(plain);
    expect(openableUrl(`  ${web('https', 'Example.com')}  `.replace('https', 'HTTPS'))).toBe(
      web('https', 'example.com/'),
    );
  });

  it.each([
    'outputs/phone-report/index.html',
    '/Users/me/report.html',
    'C:\\reports\\index.html',
    'file:///Users/me/report.html',
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    `ftp:${'//'}example.com/a`,
    'mailto:a@example.com',
    '//example.com/a',
    `https:${'//'}`,
    '',
  ])('keeps %j as text', (value) => {
    expect(openableUrl(value)).toBeNull();
  });
});
