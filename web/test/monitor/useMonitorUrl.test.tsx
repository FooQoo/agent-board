import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseMonitorRoute, useMonitorUrl } from '../../src/pages/monitor/hooks/useMonitorUrl';

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('parseMonitorRoute', () => {
  it('takes a 32-digit lowercase hexadecimal project ID', () => {
    expect(parseMonitorRoute(`?project=${ID}`)).toEqual({ status: 'ok', projectId: ID });
    expect(parseMonitorRoute(`?x=1&project=${ID}&y=2`)).toEqual({ status: 'ok', projectId: ID });
  });

  it('reports a missing project, an empty one and a page without a query', () => {
    expect(parseMonitorRoute('')).toEqual({ status: 'missing' });
    expect(parseMonitorRoute('?x=1')).toEqual({ status: 'missing' });
    expect(parseMonitorRoute('?project=')).toEqual({ status: 'missing' });
  });

  it('rejects anything that is not a project ID instead of falling back', () => {
    for (const bad of [
      'all',
      'abc',
      ID.toUpperCase(),
      `${ID}0`,
      ID.slice(1),
      `${ID.slice(0, 31)}g`,
      '../api',
      `${ID}/board`,
    ]) {
      expect(parseMonitorRoute(`?project=${encodeURIComponent(bad)}`), bad).toEqual({
        status: 'invalid',
      });
    }
    // Two projects are ambiguous, so neither is taken.
    expect(parseMonitorRoute(`?project=${ID}&project=${'b'.repeat(32)}`)).toEqual({
      status: 'invalid',
    });
  });
});

describe('useMonitorUrl', () => {
  it('reads the project from the address and keeps it for the life of the page', () => {
    window.history.replaceState(null, '', `/monitor/?project=${ID}`);
    const { result, rerender } = renderHook(() => useMonitorUrl());
    expect(result.current).toEqual({ status: 'ok', projectId: ID });
    rerender();
    expect(result.current).toEqual({ status: 'ok', projectId: ID });
  });

  it('is an error route for an address without a project', () => {
    window.history.replaceState(null, '', '/monitor/');
    const { result } = renderHook(() => useMonitorUrl());
    expect(result.current).toEqual({ status: 'missing' });
  });
});
