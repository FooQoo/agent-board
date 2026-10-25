import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOLDOWN_MS, PresentationGate } from './presentation-gate';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PresentationGate', () => {
  it('waits three seconds after the last release', () => {
    expect(COOLDOWN_MS).toBe(3_000);
  });

  it('applies an update at once while nothing is held', () => {
    const gate = new PresentationGate();
    const update = vi.fn();
    gate.submit(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('holds updates while held and applies them 3 seconds after the release, in order', () => {
    const gate = new PresentationGate();
    const calls: string[] = [];
    const release = gate.acquire('drawer');
    gate.submit(() => calls.push('a'));
    gate.submit(() => calls.push('b'));
    vi.advanceTimersByTime(60_000);
    expect(calls).toEqual([]);
    release();
    vi.advanceTimersByTime(COOLDOWN_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['a', 'b']);
    gate.submit(() => calls.push('c'));
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('cancels the timer when something is held again, and waits a full 3 seconds after that', () => {
    const gate = new PresentationGate();
    const update = vi.fn();
    const first = gate.acquire('drawer');
    gate.submit(update);
    first();
    vi.advanceTimersByTime(2_900);
    const second = gate.acquire('modal');
    vi.advanceTimersByTime(10_000);
    expect(update).not.toHaveBeenCalled();
    second();
    vi.advanceTimersByTime(2_999);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('stays held until every holder has released, and a release is counted once', () => {
    const gate = new PresentationGate();
    const update = vi.fn();
    const a = gate.acquire('a');
    const b = gate.acquire('b');
    gate.submit(update);
    a();
    a();
    vi.advanceTimersByTime(10_000);
    expect(update).not.toHaveBeenCalled();
    b();
    vi.advanceTimersByTime(COOLDOWN_MS);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('holds during the cooldown too', () => {
    const gate = new PresentationGate();
    gate.acquire('a')();
    const update = vi.fn();
    gate.submit(update);
    expect(update).not.toHaveBeenCalled();
    expect(gate.blocked).toBe(true);
    vi.advanceTimersByTime(COOLDOWN_MS);
    expect(update).toHaveBeenCalledTimes(1);
    expect(gate.blocked).toBe(false);
  });

  it('lets an immediate update (refresh, save, answer, sign-in expiry) through while held', () => {
    const gate = new PresentationGate();
    gate.acquire('drawer');
    const update = vi.fn();
    gate.submit(update, { immediate: true });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('keeps one pending update per key, the latest', () => {
    const gate = new PresentationGate();
    const release = gate.acquire('a');
    const calls: string[] = [];
    gate.submit(() => calls.push('x1'), { key: 'x' });
    gate.submit(() => calls.push('y'), { key: 'y' });
    gate.submit(() => calls.push('x2'), { key: 'x' });
    release();
    vi.advanceTimersByTime(COOLDOWN_MS);
    expect(calls).toEqual(['y', 'x2']);
  });

  it('tells listeners when it starts and stops holding back', () => {
    const gate = new PresentationGate();
    const seen: string[] = [];
    gate.subscribe((e) => seen.push(e));
    const a = gate.acquire('a');
    const b = gate.acquire('b');
    a();
    b();
    expect(seen).toEqual(['held']);
    vi.advanceTimersByTime(COOLDOWN_MS);
    expect(seen).toEqual(['held', 'open']);
  });

  it('drops pending updates and the timer on dispose', () => {
    const gate = new PresentationGate();
    const update = vi.fn();
    gate.acquire('a')();
    gate.submit(update);
    gate.dispose();
    vi.advanceTimersByTime(COOLDOWN_MS * 2);
    expect(update).not.toHaveBeenCalled();
  });
});
