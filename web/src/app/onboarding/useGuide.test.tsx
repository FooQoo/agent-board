import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '../../shared/api/contracts';
import { i18n } from '../../shared/i18n';
import '../../shared/i18n/onboarding-strings';
import type { GuideState } from './api';
import { SAMPLE_IDS } from './guideSamples';
import { RUNNING_MIN_MS } from './guideTiming';

const api = vi.hoisted(() => ({
  readGuide: vi.fn(),
  markGuideSeen: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, ...api };
});

import { requestTutorial } from './tutorialRequest';
import { useGuide } from './useGuide';

const PROJECT = 'a'.repeat(32) as ProjectId;
const OTHER_PROJECT = 'c'.repeat(32) as ProjectId;

const state = (status: GuideState['status']): GuideState => ({ formatVersion: 2, status });

function mount(eligible = true, projectId: ProjectId | null = PROJECT) {
  return renderHook(
    (props: { eligible: boolean; projectId: ProjectId | null }) => useGuide(props),
    {
      initialProps: { eligible, projectId },
    },
  );
}

/** Offers the guide and starts it, so the samples are on screen. */
async function started() {
  api.readGuide.mockResolvedValue(state('unseen'));
  const hook = mount();
  await waitFor(() => expect(hook.result.current.screen.kind).toBe('welcome'));
  act(() => hook.result.current.start());
  return hook;
}

const cardOf = (hook: Awaited<ReturnType<typeof started>>, id: number) =>
  hook.result.current.samples.find((card) => card.id === id);

describe('useGuide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.markGuideSeen.mockResolvedValue(state('completed'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers the guide when the server says it is unseen, with no claim', async () => {
    api.readGuide.mockResolvedValue(state('unseen'));
    const { result } = mount();
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
    expect(api.readGuide).toHaveBeenCalledTimes(1);
    expect(api.markGuideSeen).not.toHaveBeenCalled();
  });

  it.each(['completed', 'skipped'] as const)(
    'stays hidden when the guide was %s',
    async (status) => {
      api.readGuide.mockResolvedValue(state(status));
      const { result } = mount();
      await waitFor(() => expect(api.readGuide).toHaveBeenCalled());
      expect(result.current.screen.kind).toBe('hidden');
    },
  );

  it('waits for the board and reads once per project', async () => {
    api.readGuide.mockResolvedValue(state('completed'));
    const { rerender } = mount(false);
    expect(api.readGuide).not.toHaveBeenCalled();
    rerender({ eligible: true, projectId: PROJECT });
    await waitFor(() => expect(api.readGuide).toHaveBeenCalledTimes(1));
    rerender({ eligible: true, projectId: PROJECT });
    rerender({ eligible: true, projectId: OTHER_PROJECT });
    await waitFor(() => expect(api.readGuide).toHaveBeenCalledTimes(2));
  });

  it('shows nothing when the read fails', async () => {
    api.readGuide.mockRejectedValue(new Error('offline'));
    const { result } = mount();
    await waitFor(() => expect(api.readGuide).toHaveBeenCalled());
    expect(result.current.screen.kind).toBe('hidden');
  });

  it('records a skip and hides', async () => {
    api.readGuide.mockResolvedValue(state('unseen'));
    const { result } = mount();
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
    act(() => result.current.skip());
    expect(result.current.screen.kind).toBe('hidden');
    expect(api.markGuideSeen).toHaveBeenCalledWith('skipped');
  });

  it('hides even when recording the outcome fails', async () => {
    api.markGuideSeen.mockRejectedValue(new Error('offline'));
    const { result } = await started();
    act(() => result.current.exit());
    expect(result.current.screen.kind).toBe('hidden');
    expect(api.markGuideSeen).toHaveBeenCalledWith('skipped');
  });

  it('runs every step on local cards and records completion', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    api.readGuide.mockResolvedValue(state('unseen'));
    const hook = mount();
    await vi.waitFor(() => expect(hook.result.current.screen.kind).toBe('welcome'));
    act(() => hook.result.current.start());
    const { result } = hook;
    expect(result.current.screen.kind).toBe('step');
    // The request step has no cards yet, and Next does nothing until the request is sent.
    expect(result.current.phase).toBe('request');
    expect(result.current.samples).toEqual([]);
    act(() => result.current.next());
    expect(result.current.phase).toBe('request');

    act(() => result.current.sent());
    expect(result.current.phase).toBe('planned');
    expect(result.current.samples.map((card) => card.id)).toEqual([...SAMPLE_IDS]);
    expect(
      result.current.samples.every((card) => card.taskStatus === 'todo' && card.draft === 'ai'),
    ).toBe(true);
    expect(result.current.samples.every((card) => card.epic?.id === 'SAMPLE-1')).toBe(true);
    expect(
      result.current.samples.every(
        (card) => Array.isArray(card.acceptance) && card.acceptance.length === 2,
      ),
    ).toBe(true);

    act(() => result.current.next());
    expect(result.current.phase).toBe('question');
    expect(cardOf(hook, SAMPLE_IDS[0])).toMatchObject({
      taskStatus: 'todo',
      agentStatus: 'pending',
    });
    expect(cardOf(hook, SAMPLE_IDS[0])?.pendingChoices).toHaveLength(2);
    // The question waits for the answer: the explanation's button does nothing.
    act(() => result.current.next());
    expect(result.current.phase).toBe('question');

    act(() => result.current.answered());
    expect(result.current.phase).toBe('started');
    expect(cardOf(hook, SAMPLE_IDS[0])).toMatchObject({
      taskStatus: 'doing',
      agentStatus: 'running',
      draft: null,
    });
    // The running card stays on screen for the minimum time first.
    act(() => result.current.next());
    expect(result.current.phase).toBe('started');
    act(() => {
      vi.advanceTimersByTime(RUNNING_MIN_MS);
    });
    expect(result.current.ready).toBe(true);
    act(() => result.current.next());
    expect(result.current.phase).toBe('done');
    expect(result.current.samples.every((card) => card.taskStatus === 'done')).toBe(true);
    expect(result.current.screen.kind).toBe('step');

    act(() => result.current.next());
    expect(result.current.screen.kind).toBe('complete');

    act(() => result.current.finish());
    expect(result.current.screen.kind).toBe('hidden');
    expect(api.markGuideSeen).toHaveBeenCalledTimes(1);
    expect(api.markGuideSeen).toHaveBeenCalledWith('completed');
  });

  it('records a skip when an offered guide is ended during the run', async () => {
    const { result } = await started();
    act(() => result.current.sent());
    act(() => result.current.exit());
    expect(result.current.screen.kind).toBe('hidden');
    expect(api.markGuideSeen).toHaveBeenCalledWith('skipped');
  });

  it('shows the welcome on "Try it" whatever the server says, and records nothing on exit', async () => {
    api.readGuide.mockResolvedValue(state('completed'));
    const { result } = mount();
    await waitFor(() => expect(api.readGuide).toHaveBeenCalled());
    act(() => requestTutorial());
    expect(result.current.screen.kind).toBe('welcome');
    act(() => result.current.start());
    act(() => result.current.exit());
    expect(result.current.screen.kind).toBe('hidden');
    expect(api.markGuideSeen).not.toHaveBeenCalled();
  });

  it('keeps a replay until the board can show it', async () => {
    api.readGuide.mockResolvedValue(state('completed'));
    const { result, rerender } = mount(false);
    act(() => requestTutorial());
    expect(result.current.screen.kind).toBe('hidden');
    rerender({ eligible: true, projectId: PROJECT });
    await waitFor(() => expect(result.current.screen.kind).toBe('welcome'));
  });

  it('shows the samples in the language of the screen', async () => {
    await i18n.changeLanguage('ja');
    try {
      const hook = await started();
      act(() => hook.result.current.sent());
      expect(cardOf(hook, SAMPLE_IDS[0])?.title).toBe('今月の数値を集める');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
