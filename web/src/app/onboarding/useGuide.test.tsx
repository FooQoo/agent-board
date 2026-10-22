import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId, Task } from '../../shared/api/contracts';
import type { GuideRunState, GuideState } from './api';

const api = vi.hoisted(() => ({
  readGuide: vi.fn(),
  claimGuide: vi.fn(),
  heartbeatGuide: vi.fn(),
  skipGuide: vi.fn(),
  recoverGuide: vi.fn(),
  startGuide: vi.fn(),
  advanceGuide: vi.fn(),
  finishGuide: vi.fn(),
  replayGuide: vi.fn(),
  abortGuide: vi.fn(),
  newId: vi.fn(() => 'id-1'),
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, ...api };
});

import { requestTutorial } from './tutorialRequest';
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
  const RUN = 'b'.repeat(32);
  const OWNER = { clientId: 'tab', leaseUntil: '2099-01-01T00:00:00Z' };

  function questionRun(): GuideRunState {
    return {
      runId: RUN,
      attemptId: 'attempt',
      projectId: PROJECT,
      locale: 'en',
      sampleIds: [1, 2],
      phase: 'question',
      questionRequestId: null,
      closingReason: null,
    };
  }

  function secondCard(pendingRequestId: string | null): Task {
    return {
      id: 2,
      taskStatus: 'doing',
      pendingRequestId,
      onboardingSample: { runId: RUN, ordinal: 2 },
    } as unknown as Task;
  }

  it('does not resume the second card before its question has been seen pending', async () => {
    api.readGuide.mockResolvedValue(
      guide({ status: 'offered', revision: 4, owner: OWNER, run: questionRun() }),
    );
    const { result } = renderHook(() =>
      useGuide({ projectId: PROJECT, eligible: true, tasks: [secondCard(null)], clientId: 'tab' }),
    );
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
    await act(async () => {});
    expect(api.advanceGuide).not.toHaveBeenCalled();
  });

  it('resumes once the question has been seen pending and then answered', async () => {
    api.readGuide.mockResolvedValue(
      guide({ status: 'offered', revision: 4, owner: OWNER, run: questionRun() }),
    );
    const { result, rerender } = renderHook(
      ({ tasks }: { tasks: Task[] }) =>
        useGuide({ projectId: PROJECT, eligible: true, tasks, clientId: 'tab' }),
      { initialProps: { tasks: [secondCard('req-1')] } },
    );
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
    expect(api.advanceGuide).not.toHaveBeenCalled();
    rerender({ tasks: [secondCard(null)] });
    await waitFor(() =>
      expect(api.advanceGuide).toHaveBeenCalledWith(
        PROJECT,
        RUN,
        expect.objectContaining({ transition: 'resume-second', expectedRevision: 4 }),
      ),
    );
  });

  it('stops after a failed resume and does not send it again on its own', async () => {
    api.readGuide.mockResolvedValue(
      guide({ status: 'offered', revision: 4, owner: OWNER, run: questionRun() }),
    );
    // The failure arrives after a delay, as a network error does, so busy is rendered before it clears.
    api.advanceGuide.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('offline')), 5)),
    );
    const { result, rerender } = renderHook(
      ({ tasks }: { tasks: Task[] }) =>
        useGuide({ projectId: PROJECT, eligible: true, tasks, clientId: 'tab' }),
      { initialProps: { tasks: [secondCard('req-1')] } },
    );
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
    rerender({ tasks: [secondCard(null)] });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(api.advanceGuide).toHaveBeenCalledTimes(1);
  });

  it('starts the guide again on a tutorial request once the board can show it', async () => {
    api.readGuide.mockResolvedValue(guide({ status: 'completed', revision: 9 }));
    api.replayGuide.mockResolvedValue(
      guide({
        status: 'offered',
        revision: 10,
        owner: { clientId: 'tab', leaseUntil: '2099-01-01T00:00:00Z' },
      }),
    );
    const { result } = renderHook(() =>
      useGuide({ projectId: PROJECT, eligible: true, tasks: [], clientId: 'tab' }),
    );
    await waitFor(() => expect(api.readGuide).toHaveBeenCalled());
    expect(result.current.screen.kind).toBe('hidden');
    act(() => requestTutorial());
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
    expect(api.replayGuide).toHaveBeenCalledWith('tab', 9);
  });

  it('keeps a tutorial request until the board can show the guide', async () => {
    api.readGuide.mockResolvedValue(guide({ status: 'completed', revision: 9 }));
    api.replayGuide.mockResolvedValue(
      guide({
        status: 'offered',
        revision: 10,
        owner: { clientId: 'tab', leaseUntil: '2099-01-01T00:00:00Z' },
      }),
    );
    const { result, rerender } = renderHook(
      ({ eligible }: { eligible: boolean }) =>
        useGuide({ projectId: PROJECT, eligible, tasks: [], clientId: 'tab' }),
      { initialProps: { eligible: false } },
    );
    act(() => requestTutorial());
    await act(async () => {});
    expect(api.replayGuide).not.toHaveBeenCalled();
    rerender({ eligible: true });
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
    expect(api.replayGuide).toHaveBeenCalledTimes(1);
  });
});
