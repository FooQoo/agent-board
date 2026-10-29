import { describe, expect, it } from 'vitest';
import { isSandboxReply } from './protocol';

describe('isSandboxReply', () => {
  it('takes the replies the sandbox page sends', () => {
    expect(isSandboxReply({ type: 'ready' })).toBe(true);
    expect(isSandboxReply({ type: 'rendered' })).toBe(true);
    expect(isSandboxReply({ type: 'link', href: '../features/01_INDEX.mdx' })).toBe(true);
  });

  it('refuses a link without a text href, and anything else', () => {
    expect(isSandboxReply({ type: 'link' })).toBe(false);
    expect(isSandboxReply({ type: 'link', href: 1 })).toBe(false);
    expect(isSandboxReply({ type: 'navigate', href: 'a.md' })).toBe(false);
    expect(isSandboxReply('link')).toBe(false);
    expect(isSandboxReply(null)).toBe(false);
  });
});
