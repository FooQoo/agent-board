import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampWidth, maxWidthFor, parseStoredWidth, readStoredWidth, writeStoredWidth } from '../src/lib/detailWidth';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('parseStoredWidth', () => {
  it.each([[null], ['abc'], ['300.5'], ['279'], ['561'], ['']])('rejects %s', (raw) => {
    expect(parseStoredWidth(raw)).toBeNull();
  });
  it('accepts integers within range', () => {
    expect(parseStoredWidth('280')).toBe(280);
    expect(parseStoredWidth('560')).toBe(560);
  });
});

describe('maxWidthFor', () => {
  it('computes the room left after three minimum lanes', () => {
    expect(maxWidthFor({ bodyWidth: 1024, paddingLeft: 24, paddingRight: 24, gap: 12 })).toBe(352);
    expect(maxWidthFor({ bodyWidth: 1280, paddingLeft: 64, paddingRight: 40, gap: 12 })).toBe(552);
  });
});

describe('clampWidth', () => {
  it('clamps to the range and the layout', () => {
    expect(clampWidth(100, 560)).toBe(280);
    expect(clampWidth(900, 700)).toBe(560);
    expect(clampWidth(500, 352)).toBe(352);
    expect(clampWidth(300, 100)).toBe(280);
    expect(clampWidth(300.6, 560)).toBe(301);
  });
});

describe('storage', () => {
  it('round-trips an integer', () => {
    expect(writeStoredWidth(412)).toBe(true);
    expect(window.localStorage.getItem('skan.detailWidth')).toBe('412');
    expect(readStoredWidth()).toBe(412);
  });
  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readStoredWidth()).toBeNull();
    expect(writeStoredWidth(400)).toBe(false);
  });
});
