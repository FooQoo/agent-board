import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disablePush, enablePush, READY_TIMEOUT_MS } from './subscribe';

const api = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn() }));
vi.mock('./api', () => ({ putPushSubscription: api.put, deletePushSubscription: api.del }));

// base64url of bytes [1, 2, 3]
const KEY = 'AQID';

function subscription(key: number[] | null) {
  return {
    options: { applicationServerKey: key ? new Uint8Array(key).buffer : null },
    toJSON: () => ({ endpoint: 'endpoint-1' }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

interface Setup {
  existing: ReturnType<typeof subscription> | null;
  registered?: boolean;
}

function install({ existing, registered = true }: Setup) {
  const created = subscription([1, 2, 3]);
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existing),
    subscribe: vi.fn().mockResolvedValue(created),
  };
  const registration = { pushManager };
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue(registered ? registration : undefined),
      ready: registered ? Promise.resolve(registration) : new Promise(() => undefined),
    },
  });
  vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('granted') });
  return { pushManager, created };
}

beforeEach(() => {
  api.put.mockReset().mockResolvedValue(undefined);
  api.del.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('enablePush', () => {
  it('fails at once, without waiting for readiness, when no worker is registered', async () => {
    install({ existing: null, registered: false });
    await expect(enablePush(KEY)).resolves.toBe('failed');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('gives up when the worker never activates', async () => {
    vi.useFakeTimers();
    const { pushManager } = install({ existing: null });
    const never = new Promise(() => undefined);
    (navigator.serviceWorker as unknown as { ready: Promise<unknown> }).ready = never;
    const result = enablePush(KEY);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await expect(result).resolves.toBe('failed');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('reuses a subscription made for the same key', async () => {
    const existing = subscription([1, 2, 3]);
    const { pushManager } = install({ existing });
    await expect(enablePush(KEY)).resolves.toBe('on');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(api.put).toHaveBeenCalledOnce();
  });

  it('replaces a subscription made for another key', async () => {
    const existing = subscription([9, 9, 9]);
    const { pushManager, created } = install({ existing });
    await expect(enablePush(KEY)).resolves.toBe('on');
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
    expect(created.toJSON()).toBeDefined();
  });

  it('drops both copies when the PC request fails', async () => {
    const { created } = install({ existing: null });
    api.put.mockRejectedValue(new Error('lost'));
    await expect(enablePush(KEY)).resolves.toBe('failed');
    expect(created.unsubscribe).toHaveBeenCalledOnce();
    expect(api.del).toHaveBeenCalledOnce();
  });
});

describe('disablePush', () => {
  it('does not hang when no worker is registered, and reports the PC as clear', async () => {
    install({ existing: null, registered: false });
    await expect(disablePush()).resolves.toBe(true);
  });

  it('reports failure when the PC keeps the subscription', async () => {
    install({ existing: null });
    api.del.mockRejectedValue(new Error('down'));
    await expect(disablePush()).resolves.toBe(false);
  });
});
