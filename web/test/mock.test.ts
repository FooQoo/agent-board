import { describe, expect, it } from 'vitest';
import { readMockInitial } from '../src/mock';

describe('readMockInitial', () => {
  it('reads select, confirm and deleteFail from the query string', () => {
    expect(readMockInitial('?select=11&confirm=1&deleteFail=1')).toEqual({
      select: 11,
      confirm: true,
      deleteFail: true,
    });
  });

  it('ignores missing and invalid values', () => {
    expect(readMockInitial('')).toEqual({ select: undefined, confirm: false, deleteFail: false });
    expect(readMockInitial('?select=abc&confirm=0')).toEqual({
      select: undefined,
      confirm: false,
      deleteFail: false,
    });
    expect(readMockInitial('?select=-3')).toEqual({
      select: undefined,
      confirm: false,
      deleteFail: false,
    });
  });
});
