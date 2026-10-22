// The guide's controller: it reads and claims the guide, runs the scripted steps with
// the server's commands, keeps the lease, and returns what the view should show. The
// view parts take only props; the timers and the requests live here.

import { useCallback, useEffect, useRef, useState } from 'react';
import { i18n } from '../../shared/i18n';
import type { ProjectId, Task } from '../../shared/api/contracts';
import { type GuideScreen, HEARTBEAT_MS, NOTICE_MS, RUNNING_MIN_MS } from './guideTiming';
import {
  type GuideState,
  type GuideTransition,
  abortGuide,
  advanceGuide,
  claimGuide,
  finishGuide,
  heartbeatGuide,
  newId,
  readGuide,
  recoverGuide,
  skipGuide,
  startGuide,
  GuideError,
} from './api';

export interface GuideController {
  screen: GuideScreen;
  state: GuideState | null;
  busy: boolean;
  error: string | null;
  /** True once a running card has been on screen for the minimum time, so its step can move on. */
  ready: boolean;
  start(): void;
  skip(): void;
  next(): void;
  exit(): void;
  finish(): void;
  retry(): void;
}

interface PendingCommand {
  commandId: string;
  transition: GuideTransition;
}

function phaseOf(state: GuideState | null): string | null {
  return state?.run?.phase ?? null;
}

/**
 * The guide for one project. `eligible` is true only when the board is ready and
 * nothing else is being edited, answered, or moved. `tasks` is the board's cards,
 * which the guide reads to see whether the second card has been answered.
 */
export function useGuide({
  projectId,
  eligible,
  tasks,
  clientId,
}: {
  projectId: ProjectId | null;
  eligible: boolean;
  /** The board's cards: the second sample's question is answered when its request is gone. */
  tasks: Task[];
  clientId: string;
}): GuideController {
  const [state, setState] = useState<GuideState | null>(null);
  const [screen, setScreen] = useState<GuideScreen>({ kind: 'hidden' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const bound = useRef<ProjectId | null>(null);
  const pending = useRef<PendingCommand | null>(null);
  const attempt = useRef<string | null>(null);
  const checked = useRef(false);
  // The run whose second question has been seen pending on its card.
  const askedRun = useRef<string | null>(null);
  const stateRef = useRef<GuideState | null>(null);
  stateRef.current = state;

  const apply = useCallback((next: GuideState) => {
    setState(next);
    setError(null);
    return next;
  }, []);

  const fail = useCallback((cause: unknown) => {
    setBusy(false);
    const network = i18n.t('onboarding.guide.networkError');
    setError(cause instanceof GuideError ? (cause.reason ?? cause.message) : network);
  }, []);

  // Read the guide once the board is ready, and offer it when the data area has not seen it.
  useEffect(() => {
    if (!eligible || !projectId || checked.current) return;
    checked.current = true;
    bound.current = projectId;
    void (async () => {
      try {
        let current = await readGuide();
        if (current.status === 'active' && !current.owner) {
          current = await recoverGuide();
        }
        if (current.status === 'unseen' || current.status === 'interrupted') {
          current = await claimGuide(clientId, current.revision);
        }
        if (current.status === 'offered' && current.owner?.clientId === clientId) {
          apply(current);
          setScreen({ kind: 'welcome' });
        }
      } catch {
        // The guide is optional: a failed read shows nothing and the board stays usable.
      }
    })();
  }, [eligible, projectId, clientId, apply]);

  // Keep the lease while the guide is on screen.
  useEffect(() => {
    if (screen.kind === 'hidden') return undefined;
    const timer = window.setInterval(() => {
      void heartbeatGuide(clientId)
        .then(apply)
        .catch(() => {
          setScreen({ kind: 'hidden' });
        });
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [screen.kind, clientId, apply]);

  const run = useCallback(
    async (transition: GuideTransition) => {
      const current = stateRef.current;
      const project = bound.current;
      if (!current || !project || !current.run) return;
      setBusy(true);
      // A retry sends the same command again; the server answers it once.
      const command =
        pending.current?.transition === transition
          ? pending.current
          : { commandId: newId(), transition };
      pending.current = command;
      try {
        const next = await advanceGuide(project, current.run.runId, {
          clientId,
          expectedRevision: current.revision,
          commandId: command.commandId,
          transition,
        });
        pending.current = null;
        apply(next);
        setBusy(false);
      } catch (cause) {
        fail(cause);
      }
    },
    [apply, clientId, fail],
  );

  const phase = phaseOf(state);
  const runId = state?.run?.runId ?? null;
  const secondCard = tasks.find(
    (task) => task.onboardingSample?.runId === runId && task.onboardingSample?.ordinal === 2,
  );
  const questionPending = secondCard !== undefined && secondCard.pendingRequestId !== null;
  // The board's cards can lag behind the server. The question counts as asked only once this
  // run's card has shown it pending, so a card that has not been asked yet never looks answered.
  useEffect(() => {
    if (runId !== null && questionPending) askedRun.current = runId;
  }, [runId, questionPending]);
  const questionAnswered = runId !== null && askedRun.current === runId && !questionPending;

  // The second card's answer has reached the board: the guide resumes at once. After a failure
  // the guide waits for the user's Retry, so a failing request is not sent again on its own.
  useEffect(() => {
    if (screen.kind === 'hidden' || busy || error) return undefined;
    if (phase === 'question' && questionAnswered) void run('resume-second');
    return undefined;
  }, [phase, questionAnswered, screen.kind, busy, error, run]);

  // A running card stays on screen for at least RUNNING_MIN_MS before its step can move on.
  useEffect(() => {
    setReady(false);
    if (phase !== 'first-running' && phase !== 'second-running') return undefined;
    const timer = window.setTimeout(() => setReady(true), RUNNING_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Show the screen that matches the server's phase.
  useEffect(() => {
    if (screen.kind === 'hidden' || screen.kind === 'welcome' || screen.kind === 'notice') return;
    if (phase === 'second-done' || phase === 'complete') setScreen({ kind: 'complete' });
    else if (screen.kind === 'complete') setScreen({ kind: 'step' });
  }, [phase, screen.kind]);

  const start = useCallback(() => {
    const current = stateRef.current;
    const project = bound.current;
    if (!current || !project) return;
    setBusy(true);
    attempt.current ??= newId();
    const locale = i18n.resolvedLanguage === 'ja' ? 'ja' : 'en';
    startGuide(project, {
      clientId,
      attemptId: attempt.current,
      expectedRevision: current.revision,
      locale,
    })
      .then((next) => {
        apply(next);
        setBusy(false);
        setScreen({ kind: 'step' });
      })
      .catch(fail);
  }, [apply, clientId, fail]);

  const skip = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    setBusy(true);
    skipGuide(clientId, current.revision, newId())
      .then((next) => {
        apply(next);
        setBusy(false);
        setScreen({ kind: 'hidden' });
      })
      .catch(fail);
  }, [apply, clientId, fail]);

  const exit = useCallback(() => {
    const current = stateRef.current;
    const project = bound.current;
    if (!current || !project) {
      setScreen({ kind: 'hidden' });
      return;
    }
    if (!current.run) {
      skip();
      return;
    }
    setBusy(true);
    abortGuide(project, current.run.runId, {
      clientId,
      expectedRevision: current.revision,
      commandId: newId(),
    })
      .then((next) => {
        apply(next);
        setBusy(false);
        setScreen({ kind: 'hidden' });
      })
      .catch(fail);
  }, [apply, clientId, fail, skip]);

  const finish = useCallback(async () => {
    const project = bound.current;
    if (!project) return;
    setBusy(true);
    try {
      // The last step is taken before the run is finished: the dialog's button does both.
      let current = stateRef.current;
      if (current?.run?.phase === 'second-done') {
        current = apply(
          await advanceGuide(project, current.run.runId, {
            clientId,
            expectedRevision: current.revision,
            commandId: newId(),
            transition: 'complete',
          }),
        );
      }
      if (!current?.run) return;
      const next = await finishGuide(project, current.run.runId, {
        clientId,
        expectedRevision: current.revision,
        commandId: newId(),
      });
      apply(next);
      setBusy(false);
      setScreen({ kind: 'notice' });
      window.setTimeout(() => setScreen({ kind: 'hidden' }), NOTICE_MS);
    } catch (cause) {
      fail(cause);
    }
  }, [apply, clientId, fail]);

  // The explanation's "次へ". A running card's step is enabled only once the card has been on screen long enough.
  const next = useCallback(() => {
    if (phase === 'samples') void run('first-running');
    else if (phase === 'first-running' && ready) void run('first-done');
    else if (phase === 'first-done') void run('ask-question');
    else if (phase === 'second-running' && ready) void run('second-done');
  }, [phase, ready, run]);

  const retry = useCallback(() => {
    setError(null);
    if (screen.kind === 'welcome') start();
    else if (screen.kind === 'complete') finish();
    else if (pending.current) void run(pending.current.transition);
    else next();
  }, [finish, next, run, screen.kind, start]);

  return { screen, state, busy, error, ready, start, skip, next, exit, finish, retry };
}
