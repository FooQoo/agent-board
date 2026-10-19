import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimBuildReload } from '../../src/app/model/buildReload';
import { pageBuildId, readyBuildId } from '../../src/shared/lib/build/buildId';

const OWN = '0123456789abcdef';
const NEW = 'fedcba9876543210';

function setMeta(content: string | null) {
  document.head.querySelector('meta[name="agboard-build"]')?.remove();
  if (content === null) return;
  const meta = document.createElement('meta');
  meta.name = 'agboard-build';
  meta.content = content;
  document.head.append(meta);
}

beforeEach(() => sessionStorage.clear());
afterEach(() => setMeta(null));

describe('pageBuildId', () => {
  it('reads the build ID the server filled in', () => {
    setMeta(OWN);
    expect(pageBuildId()).toBe(OWN);
  });

  it('is null without the meta or with the placeholder a dev server leaves', () => {
    expect(pageBuildId()).toBeNull();
    setMeta('{{AGBOARD_BUILD_ID}}');
    expect(pageBuildId()).toBeNull();
  });
});

describe('readyBuildId', () => {
  it('reads the build from the ready data', () => {
    expect(readyBuildId(new MessageEvent('ready', { data: `{"build":"${NEW}"}` }))).toBe(NEW);
  });

  it('is null for missing, malformed or foreign data', () => {
    expect(readyBuildId(new Event('ready'))).toBeNull();
    expect(readyBuildId(new MessageEvent('ready', { data: '{}' }))).toBeNull();
    expect(readyBuildId(new MessageEvent('ready', { data: 'not json' }))).toBeNull();
    expect(readyBuildId(new MessageEvent('ready', { data: '{"build":"x"}' }))).toBeNull();
  });
});

describe('claimBuildReload', () => {
  it('reloads once for a new build and never again for the same build', () => {
    expect(claimBuildReload(NEW, OWN)).toBe(true);
    expect(claimBuildReload(NEW, OWN)).toBe(false);
  });

  it('does not reload on the current build, and forgets the attempt there', () => {
    expect(claimBuildReload(NEW, OWN)).toBe(true);
    expect(claimBuildReload(NEW, NEW)).toBe(false);
    expect(claimBuildReload(OWN, NEW)).toBe(true);
  });

  it('never reloads a page without a build ID', () => {
    expect(claimBuildReload(NEW, null)).toBe(false);
  });
});
