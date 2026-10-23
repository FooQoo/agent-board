import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventConnection, type VisibilitySource } from './event-connection';
import { changed, FakeAdapter, P } from './test-support';

let adapter: FakeAdapter;
let hidden: boolean;
let visibilityListeners: Array<() => void>;
const visibility: VisibilitySource = {
  hidden: () => hidden,
  subscribe: (listener) => {
    visibilityListeners.push(listener);
    return () => {
      visibilityListeners = visibilityListeners.filter((l) => l !== listener);
    };
  },
};
const setHidden = (value: boolean) => {
  hidden = value;
  for (const l of [...visibilityListeners]) l();
};

const calls = {
  changed: vi.fn(),
  reset: vi.fn(),
  connected: vi.fn(),
  ready: vi.fn(),
  preferences: vi.fn(),
  state: vi.fn(),
};
let connection: EventConnection;

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(calls)) fn.mockClear();
  adapter = new FakeAdapter();
  hidden = false;
  visibilityListeners = [];
  connection = new EventConnection({
    adapter,
    visibility,
    onChanged: calls.changed,
    onReset: calls.reset,
    onConnected: calls.connected,
    onReady: calls.ready,
    onPreferences: calls.preferences,
    onState: calls.state,
  });
});
afterEach(() => {
  connection.stop();
  vi.useRealTimers();
});

const open = () => adapter.handlers?.onOpen?.();

describe('opening', () => {
  it('subscribes first and reports the connection only once the subscription is open', () => {
    connection.start();
    expect(adapter.opened).toBe(1);
    expect(connection.state).toBe('connecting');
    expect(calls.connected).not.toHaveBeenCalled();
    open();
    expect(connection.state).toBe('connected');
    expect(calls.connected).toHaveBeenCalledTimes(1);
    expect(calls.connected).toHaveBeenCalledWith(false);
  });

  it('passes notifications, the build ID and preferences on', () => {
    connection.start();
    open();
    const event = changed(1, [{ resource: 'task', id: 1, facets: ['summary'] }]);
    adapter.handlers?.onChanged(event);
    adapter.handlers?.onReady?.('build-7');
    adapter.handlers?.onPreferences?.({ theme: 'dark' });
    adapter.handlers?.onReset('unknown-event');
    expect(calls.changed).toHaveBeenCalledWith(event);
    expect(calls.ready).toHaveBeenCalledWith('build-7');
    expect(calls.preferences).toHaveBeenCalledWith({ theme: 'dark' });
    expect(calls.reset).toHaveBeenCalledWith('unknown-event');
    expect(event.projectId).toBe(P);
  });
});

describe('reconnecting', () => {
  it('reopens after 1, 2, 5, 10 and then every 30 seconds, and starts over after a good open', () => {
    connection.start();
    const delays = [1_000, 2_000, 5_000, 10_000, 30_000, 30_000];
    delays.forEach((delay, i) => {
      adapter.handlers?.onClose?.();
      expect(connection.state).toBe('disconnected');
      vi.advanceTimersByTime(delay - 1);
      expect(adapter.opened).toBe(i + 1);
      vi.advanceTimersByTime(1);
      expect(adapter.opened).toBe(i + 2);
    });
    open();
    adapter.handlers?.onClose?.();
    vi.advanceTimersByTime(999);
    expect(adapter.opened).toBe(delays.length + 1);
    vi.advanceTimersByTime(1);
    expect(adapter.opened).toBe(delays.length + 2);
  });

  it('tells the listener it is a reconnect, so it fetches the Summary again', () => {
    connection.start();
    open();
    adapter.handlers?.onClose?.();
    vi.advanceTimersByTime(1_000);
    open();
    expect(calls.connected).toHaveBeenNthCalledWith(2, true);
  });

  it('drops a connection that stays silent for 45 seconds', () => {
    connection.start();
    open();
    vi.advanceTimersByTime(44_999);
    expect(connection.state).toBe('connected');
    vi.advanceTimersByTime(1);
    expect(connection.state).toBe('disconnected');
    expect(adapter.closed).toBe(1);
  });

  it('counts a heartbeat or a notification as a sign of life', () => {
    connection.start();
    open();
    vi.advanceTimersByTime(30_000);
    adapter.handlers?.onHeartbeat?.();
    vi.advanceTimersByTime(30_000);
    adapter.handlers?.onChanged(changed(1, []));
    vi.advanceTimersByTime(44_999);
    expect(connection.state).toBe('connected');
    vi.advanceTimersByTime(1);
    expect(connection.state).toBe('disconnected');
  });

  it('ignores what a connection it already closed still says', () => {
    connection.start();
    open();
    const old = adapter.handlers;
    adapter.handlers?.onClose?.();
    vi.advanceTimersByTime(1_000);
    old?.onChanged(changed(1, []));
    old?.onClose?.();
    expect(calls.changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(adapter.opened).toBe(2);
  });
});

describe('a hidden tab', () => {
  it('disconnects while hidden and reconnects when it is visible again', () => {
    connection.start();
    open();
    setHidden(true);
    expect(connection.state).toBe('hidden');
    expect(adapter.closed).toBe(1);
    vi.advanceTimersByTime(120_000);
    expect(adapter.opened).toBe(1);
    setHidden(false);
    expect(adapter.opened).toBe(2);
    open();
    expect(calls.connected).toHaveBeenLastCalledWith(true);
  });

  it('does not open while the tab is hidden at the start', () => {
    hidden = true;
    connection.start();
    expect(connection.state).toBe('hidden');
    expect(adapter.opened).toBe(0);
    setHidden(false);
    expect(adapter.opened).toBe(1);
    open();
    expect(calls.connected).toHaveBeenLastCalledWith(false);
  });

  it('does not retry while hidden', () => {
    connection.start();
    adapter.handlers?.onClose?.();
    setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(adapter.opened).toBe(1);
  });
});

describe('stop', () => {
  it('closes the subscription and cancels the retry', () => {
    connection.start();
    adapter.handlers?.onClose?.();
    connection.stop();
    vi.advanceTimersByTime(60_000);
    expect(adapter.opened).toBe(1);
    expect(connection.state).toBe('stopped');
  });
});
