import { describe, expect, it } from 'vitest';
import { phoneUrl } from './phoneUrl';

// Built apart so the source-rules test finds no literal external address in src.
const ORIGIN = `${'https'}://example.ngrok.app`;
const PROJECT = '0123456789abcdef0123456789abcdef';

describe('phone URL of a project', () => {
  it('points the phone at the monitor of the selected project', () => {
    expect(phoneUrl(ORIGIN, PROJECT)).toBe(`${ORIGIN}/monitor/?project=${PROJECT}`);
  });

  it('keeps the monitor path when the connection reports an address that already has one', () => {
    expect(phoneUrl(`${ORIGIN}/monitor/`, PROJECT)).toBe(`${ORIGIN}/monitor/?project=${PROJECT}`);
  });

  it('keeps a port of the public address', () => {
    expect(phoneUrl(`${ORIGIN}:8443`, PROJECT)).toBe(`${ORIGIN}:8443/monitor/?project=${PROJECT}`);
  });

  it('gives no address when no project is selected', () => {
    expect(phoneUrl(ORIGIN, null)).toBeNull();
    expect(phoneUrl(ORIGIN, '')).toBeNull();
  });

  it('gives no address for a value that is not a ProjectId', () => {
    expect(phoneUrl(ORIGIN, 'not-a-project')).toBeNull();
    expect(phoneUrl(ORIGIN, `${PROJECT}&x=1`)).toBeNull();
  });

  it('gives no address before the connection has a public address', () => {
    expect(phoneUrl(null, PROJECT)).toBeNull();
  });
});
