import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '../../shared/api/contracts';
import type { GuideState } from './api';

const api = vi.hoisted(() => ({
  readGuide: vi.fn(),
  claimGuide: vi.fn(),
  heartbeatGuide: vi.fn(),
  skipGuide: vi.fn(),
  recoverGuide: vi.fn(),
  startGuide: vi.fn(),
  advanceGuide: vi.fn(),
  finishGuide: vi.fn(),
  abortGuide: vi.fn(),
  newId: vi.fn(() => 'id-1'),
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, ...api };
});

import { useGuide } from './useGuide';

const PROJECT = 'a'.repeat(32) as ProjectId;

function guide(patch: Partial<GuideState>): GuideState {
  return {
    formatVersion: 1,
    revision: 0,
    status: 'unseen',
    owner: null,
    run: null,
    appliedCommands: [],
    ...patch,
  };
}

describe('useGuide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers the guide on an unseen data area by claiming it for this tab', async () => {
    api.readGuide.mockResolvedValue(guide({ status: 'unseen' }));
    api.claimGuide.mockResolvedValue(
      guide({
        status: 'offered',
        revision: 1,
        owner: { clientId: 'tab', leaseUntil: '2099-01-01T00:00:00Z' },
      }),
    );
    const { result } = renderHook(() =>
      useGuide({ projectId: PROJECT, eligible: true, tasks: [], clientId: 'tab' }),
    );
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
    expect(api.claimGuide).toHaveBeenCalledWith('tab', 0);
  });

  it('shows nothing when the guide was completed or skipped', async () => {
    api.readGuide.mockResolvedValue(guide({ status: 'completed', revision: 9 }));
    const { result } = renderHook(() =>
      useGuide({ projectId: PROJECT, eligible: true, tasks: [], clientId: 'tab' }),
    );
    await waitFor(() => expect(api.readGuide).toHaveBeenCalled());
    expect(result.current.screen.kind).toBe('hidden');
    expect(api.claimGuide).not.toHaveBeenCalled();
  });

  it('waits until the board is eligible before reading the guide', async () => {
    const { result } = renderHook(() =>
      useGuide({ projectId: PROJECT, eligible: false, tasks: [], clientId: 'tab' }),
    );
    await act(async () => {});
    expect(api.readGuide).not.toHaveBeenCalled();
    expect(result.current.screen.kind).toBe('hidden');
  });

  it('skips without creating anything and hides the guide', async () => {
    api.readGuide.mockResolvedValue(guide({ status: 'unseen' }));
    api.claimGuide.mockResolvedValue(
      guide({
        status: 'offered',
        revision: 1,
        owner: { clientId: 'tab', leaseUntil: '2099-01-01T00:00:00Z' },
      }),
    );
    api.skipGuide.mockResolvedValue(guide({ status: 'skipped', revision: 2 }));
    const { result } = renderHook(() =>
      useGuide({ projectId: PROJECT, eligible: true, tasks: [], clientId: 'tab' }),
    );
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
    await act(async () => result.current.skip());
    expect(api.skipGuide).toHaveBeenCalledWith('tab', 1, 'id-1');
    expect(result.current.screen.kind).toBe('hidden');
  });
});
