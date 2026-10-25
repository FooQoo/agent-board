import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId, Task } from '../../shared/api/contracts';
import { i18n } from '../../shared/i18n';
import '../../shared/i18n/onboarding-strings';
import { GuideError, type GuideRunState, type GuideState } from './api';
import { HEARTBEAT_MS, NOTICE_MS } from './guideTiming';

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
const OTHER_PROJECT = 'c'.repeat(32) as ProjectId;

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

  describe('a guide left active by a closed or reloaded tab', () => {
    const OFFERED = guide({ status: 'offered', revision: 7, owner: OWNER });

    it('takes back a run whose lease has expired, then offers the guide again', async () => {
      api.readGuide.mockResolvedValue(
        guide({
          status: 'active',
          revision: 5,
          owner: { clientId: 'old-tab', leaseUntil: '2000-01-01T00:00:00Z' },
          run: questionRun(),
        }),
      );
      api.recoverGuide.mockResolvedValue(guide({ status: 'interrupted', revision: 6 }));
      api.claimGuide.mockResolvedValue(OFFERED);
      const { result } = renderHook(() =>
        useGuide({ projectId: PROJECT, eligible: true, tasks: [], clientId: 'tab' }),
      );
      await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
      expect(api.recoverGuide).toHaveBeenCalledTimes(1);
      expect(api.claimGuide).toHaveBeenCalledWith('tab', 6);
      expect(api.recoverGuide.mock.invocationCallOrder[0]).toBeLessThan(
        api.claimGuide.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('takes back a run that no tab holds', async () => {
      api.readGuide.mockResolvedValue(
        guide({ status: 'active', revision: 5, owner: null, run: questionRun() }),
      );
      api.recoverGuide.mockResolvedValue(guide({ status: 'interrupted', revision: 6 }));
      api.claimGuide.mockResolvedValue(OFFERED);
      const { result } = renderHook(() =>
        useGuide({ projectId: PROJECT, eligible: true, tasks: [], clientId: 'tab' }),
      );
      await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
      expect(api.recoverGuide).toHaveBeenCalledTimes(1);
      expect(api.claimGuide).toHaveBeenCalledWith('tab', 6);
    });

    it('leaves a run alone while another tab holds a live lease', async () => {
      api.readGuide.mockResolvedValue(
        guide({
          status: 'active',
          revision: 5,
          owner: { clientId: 'other-tab', leaseUntil: '2099-01-01T00:00:00Z' },
          run: questionRun(),
        }),
      );
      const { result } = renderHook(() =>
        useGuide({ projectId: PROJECT, eligible: true, tasks: [], clientId: 'tab' }),
      );
      await waitFor(() => expect(api.readGuide).toHaveBeenCalled());
      await act(async () => {});
      expect(api.recoverGuide).not.toHaveBeenCalled();
      expect(api.claimGuide).not.toHaveBeenCalled();
      expect(result.current.screen.kind).toBe('hidden');
    });
  });

  describe('a failed request', () => {
    async function welcomeThenStart(failure: Error) {
      api.readGuide.mockResolvedValue(guide({ status: 'offered', revision: 1, owner: OWNER }));
      api.startGuide.mockRejectedValue(failure);
      const hook = renderHook(() =>
        useGuide({ projectId: PROJECT, eligible: true, tasks: [], clientId: 'tab' }),
      );
      await waitFor(() => expect(hook.result.current.screen.kind).toBe('welcome'));
      await act(async () => hook.result.current.start());
      await waitFor(() => expect(hook.result.current.error).not.toBeNull());
      return hook.result.current.error;
    }

    it('shows the translated text for a server fault instead of its English text', async () => {
      const error = await welcomeThenStart(
        new GuideError(500, 'request_failed', 'Request failed (500)'),
      );
      expect(error).toBe(i18n.t('onboarding.guide.networkError'));
      expect(error).not.toContain('Request failed');
    });

    it('keeps the reason of a refused request', async () => {
      const error = await welcomeThenStart(
        new GuideError(409, 'stale_revision', 'The guide changed in another tab.'),
      );
      expect(error).toBe('The guide changed in another tab.');
    });
  });

  describe('the lease heartbeat', () => {
    async function advance(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    async function welcome() {
      vi.useFakeTimers();
      api.readGuide.mockResolvedValue(
        guide({ status: 'offered', revision: 1, owner: OWNER, run: questionRun() }),
      );
      const hook = renderHook(() =>
        useGuide({ projectId: PROJECT, eligible: true, tasks: [], clientId: 'tab' }),
      );
      await vi.waitFor(() => expect(hook.result.current.screen.kind).toBe('welcome'));
      return hook;
    }

    it('keeps the error of a failed request on screen when a heartbeat succeeds', async () => {
      api.startGuide.mockRejectedValue(
        new GuideError(500, 'request_failed', 'Request failed (500)'),
      );
      api.heartbeatGuide.mockResolvedValue(
        guide({ status: 'offered', revision: 2, owner: OWNER, run: questionRun() }),
      );
      const { result } = await welcome();
      await act(async () => result.current.start());
      expect(result.current.error).toBe(i18n.t('onboarding.guide.networkError'));
      await advance(HEARTBEAT_MS);
      expect(api.heartbeatGuide).toHaveBeenCalledTimes(1);
      // The renewal recorded the server's state, but the error is still there to be retried.
      expect(result.current.state?.revision).toBe(2);
      expect(result.current.error).toBe(i18n.t('onboarding.guide.networkError'));
    });

    it('does not renew the lease while the archive notice is shown', async () => {
      api.heartbeatGuide.mockResolvedValue(guide({ status: 'offered', revision: 1, owner: OWNER }));
      api.finishGuide.mockResolvedValue(guide({ status: 'completed', revision: 5 }));
      const { result } = await welcome();
      // Finish one second before a renewal is due, so the old timer would fire inside the notice.
      await advance(HEARTBEAT_MS - 1000);
      await act(async () => result.current.finish());
      expect(result.current.screen.kind).toBe('notice');
      await advance(NOTICE_MS - 1);
      expect(result.current.screen.kind).toBe('notice');
      expect(api.heartbeatGuide).not.toHaveBeenCalled();
      await advance(1);
      expect(result.current.screen.kind).toBe('hidden');
    });

    it('hides the guide without logging an error when the server refuses a renewal', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      api.heartbeatGuide.mockRejectedValue(
        new GuideError(409, 'not_owner', 'This tab no longer holds the guide.'),
      );
      const { result } = await welcome();
      await advance(HEARTBEAT_MS);
      expect(api.heartbeatGuide).toHaveBeenCalledTimes(1);
      expect(result.current.screen.kind).toBe('hidden');
      expect(logged).not.toHaveBeenCalled();
      logged.mockRestore();
    });
  });

  describe('when the user switches to another project', () => {
    function render() {
      return renderHook(
        ({ projectId }: { projectId: ProjectId }) =>
          useGuide({ projectId, eligible: true, tasks: [], clientId: 'tab' }),
        { initialProps: { projectId: PROJECT } },
      );
    }

    it('starts a replayed guide in the project on screen, not the first one', async () => {
      api.readGuide.mockResolvedValue(guide({ status: 'completed', revision: 9 }));
      api.replayGuide.mockResolvedValue(guide({ status: 'offered', revision: 10, owner: OWNER }));
      api.startGuide.mockResolvedValue(
        guide({ status: 'active', revision: 11, owner: OWNER, run: questionRun() }),
      );
      const { result, rerender } = render();
      await waitFor(() => expect(api.readGuide).toHaveBeenCalledTimes(1));
      rerender({ projectId: OTHER_PROJECT });
      await waitFor(() => expect(api.readGuide).toHaveBeenCalledTimes(2));
      act(() => requestTutorial());
      await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
      await act(async () => result.current.start());
      expect(api.startGuide).toHaveBeenCalledWith(
        OTHER_PROJECT,
        expect.objectContaining({ clientId: 'tab', expectedRevision: 10 }),
      );
    });

    it('offers an interrupted guide on the next project, and reads each project once', async () => {
      api.readGuide
        .mockResolvedValueOnce(guide({ status: 'completed', revision: 9 }))
        .mockResolvedValue(guide({ status: 'interrupted', revision: 12 }));
      api.claimGuide.mockResolvedValue(guide({ status: 'offered', revision: 13, owner: OWNER }));
      const { result, rerender } = render();
      await waitFor(() => expect(api.readGuide).toHaveBeenCalledTimes(1));
      expect(result.current.screen.kind).toBe('hidden');
      rerender({ projectId: OTHER_PROJECT });
      await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
      expect(api.claimGuide).toHaveBeenCalledWith('tab', 12);
      rerender({ projectId: OTHER_PROJECT });
      await act(async () => {});
      expect(api.readGuide).toHaveBeenCalledTimes(2);
    });
  });
});
