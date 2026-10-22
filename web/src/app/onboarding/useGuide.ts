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
  const bound = useRef<ProjectId | null>(null);
  const pending = useRef<PendingCommand | null>(null);
  const attempt = useRef<string | null>(null);
  const phaseEnteredAt = useRef<number>(0);
  const checked = useRef(false);
  const stateRef = useRef<GuideState | null>(null);
  stateRef.current = state;

  const apply = useCallback((next: GuideState) => {
    setState(next);
    setError(null);
    return next;
  }, []);

  const fail = useCallback((cause: unknown) => {
    setBusy(false);
    const reason = cause instanceof GuideError ? (cause.reason ?? cause.message) : String(cause);
    setError(reason);
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
        phaseEnteredAt.current = Date.now();
        apply(next);
        setBusy(false);
      } catch (cause) {
        fail(cause);
      }
    },
    [apply, clientId, fail],
  );

  // Steps the server finishes on its own: a running card waits at least RUNNING_MIN_MS.
  const phase = phaseOf(state);
  const runId = state?.run?.runId ?? null;
  const questionAnswered =
    runId !== null &&
    tasks.some(
      (task) =>
        task.onboardingSample?.runId === runId &&
        task.onboardingSample.ordinal === 2 &&
        task.pendingRequestId === null,
    );
  useEffect(() => {
    if (screen.kind === 'hidden' || busy) return undefined;
    let transition: GuideTransition | null = null;
    if (phase === 'first-running') transition = 'first-done';
    if (phase === 'question' && questionAnswered) transition = 'resume-second';
    if (!transition) return undefined;
    const wait =
      transition === 'resume-second' ? 0 : RUNNING_MIN_MS - (Date.now() - phaseEnteredAt.current);
    const timer = window.setTimeout(
      () => void run(transition as GuideTransition),
      Math.max(0, wait),
    );
    return () => window.clearTimeout(timer);
  }, [phase, questionAnswered, screen.kind, busy, run]);

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
        phaseEnteredAt.current = Date.now();
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

  // The explanation's "次へ": the step waits until the running card has been on screen long enough.
  const next = useCallback(() => {
    if (phase === 'samples') void run('first-running');
    else if (phase === 'first-done') void run('ask-question');
    else if (phase === 'second-running') {
      const wait = RUNNING_MIN_MS - (Date.now() - phaseEnteredAt.current);
      window.setTimeout(() => void run('second-done'), Math.max(0, wait));
    }
  }, [phase, run]);

  const retry = useCallback(() => {
    setError(null);
    if (screen.kind === 'welcome') start();
    else if (screen.kind === 'complete') finish();
    else if (pending.current) void run(pending.current.transition);
    else next();
  }, [finish, next, run, screen.kind, start]);

  return { screen, state, busy, error, start, skip, next, exit, finish, retry };
}
