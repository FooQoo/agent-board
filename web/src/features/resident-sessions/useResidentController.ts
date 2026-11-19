import { useCallback, useEffect, useState } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import {
  ResidentRequestError,
  getModels,
  launchSession,
  saveAutoStart,
  stopSession,
  type ModelOption,
  type SessionTool,
} from './api';
import { notifyResidentChanged } from './events';
import type { Pending, ResidentProblem } from './types';
import { autoStartIsOn, cliProblemOf, initialChoice, type Choice, type CliProblem } from './state';
import { DIALOG_POLL_MS, useResidentSession } from './useResidentSession';

interface Models {
  tool: SessionTool;
  options: ModelOption[];
  /** Why the list could not be read; only the default model is offered then. */
  reason: string | null;
  problem: ResidentProblem | null;
}

const problemOf = (cause: unknown): ResidentProblem =>
  cause instanceof ResidentRequestError
    ? { code: cause.code, reason: cause.reason, unreachable: cause.status === 0 }
    : { code: null, reason: null, unreachable: true };

/**
 * The state behind the dialog. It reads the sessions every two seconds while it is mounted, keeps
 * the tool and model the person chose (which apply from the next start), and runs Start, Stop,
 * Restart and the auto-start checkbox. A request in flight disables the controls.
 */
export function useResidentController(projectId: ProjectId) {
  const { snapshot, failed, refresh } = useResidentSession(projectId, DIALOG_POLL_MS);
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [models, setModels] = useState<Models | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [savingAuto, setSavingAuto] = useState(false);
  const [problem, setProblem] = useState<ResidentProblem | null>(null);
  const [launchProblem, setLaunchProblem] = useState<ResidentProblem | null>(null);

  const health = snapshot?.health ?? null;
  const choice: Choice | null = chosen ?? (health ? initialChoice(health) : null);
  const tool = choice?.tool ?? null;

  const loadModels = useCallback(async () => {
    if (tool === null) return;
    try {
      const list = await getModels(projectId, tool);
      setModels({ tool, options: list.models, reason: list.reason, problem: null });
    } catch (cause) {
      setModels({ tool, options: [], reason: null, problem: problemOf(cause) });
    }
  }, [projectId, tool]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const changed = useCallback(async () => {
    await refresh();
    notifyResidentChanged();
  }, [refresh]);

  /** Saves the auto-start choice when it is on, so it keeps following the chosen tool and model. */
  const followAutoStart = useCallback(
    async (next: Choice) => {
      setSavingAuto(true);
      setProblem(null);
      try {
        await saveAutoStart(projectId, { enabled: true, ...next });
        await changed();
      } catch (cause) {
        setProblem(problemOf(cause));
      } finally {
        setSavingAuto(false);
      }
    },
    [projectId, changed],
  );

  const autoStart = health ? autoStartIsOn(health.autoStart, projectId) : false;

  const choose = (next: Choice) => {
    setChosen(next);
    setLaunchProblem(null);
    if (autoStart) void followAutoStart(next);
  };

  const start = async () => {
    if (!choice || pending) return;
    setChosen(choice);
    setPending('starting');
    setLaunchProblem(null);
    setProblem(null);
    try {
      await launchSession(projectId, choice.tool, choice.model);
    } catch (cause) {
      setLaunchProblem(problemOf(cause));
    }
    await changed();
    setPending(null);
  };

  const stop = async () => {
    if (pending) return;
    // The choice stays what it was after the session is gone.
    if (choice) setChosen(choice);
    setPending('stopping');
    setProblem(null);
    try {
      await stopSession(projectId);
    } catch (cause) {
      setProblem(problemOf(cause));
    }
    await changed();
    setPending(null);
  };

  const setAutoStart = async (enabled: boolean) => {
    if (!choice) return;
    if (enabled) return followAutoStart(choice);
    setSavingAuto(true);
    setProblem(null);
    try {
      await saveAutoStart(projectId, { enabled: false });
      await changed();
    } catch (cause) {
      setProblem(problemOf(cause));
    } finally {
      setSavingAuto(false);
    }
  };

  const checkAgain = async () => {
    setLaunchProblem(null);
    await loadModels();
  };

  // The CLI problem of the chosen tool: the model list says "not installed" before any launch, and a
  // launch says "not logged in".
  const cliProblem: CliProblem | null =
    cliProblemOf(launchProblem?.code ?? null) ??
    (models?.tool === tool ? cliProblemOf(models.problem?.code ?? null) : null);
  const cliReason =
    (launchProblem && cliProblemOf(launchProblem.code) ? launchProblem.reason : null) ??
    (models?.tool === tool ? (models.problem?.reason ?? null) : null);

  return {
    snapshot,
    failed,
    choice,
    models: models?.tool === tool ? models : null,
    pending,
    savingAuto,
    autoStart,
    cliProblem,
    cliReason,
    /** A failed launch that is not a CLI problem. */
    launchProblem: launchProblem && !cliProblemOf(launchProblem.code) ? launchProblem : null,
    problem,
    chooseTool: (next: SessionTool) => choose({ tool: next, model: '' }),
    chooseModel: (model: string) => choice && choose({ ...choice, model }),
    start: () => void start(),
    stop: () => void stop(),
    setAutoStart: (enabled: boolean) => void setAutoStart(enabled),
    checkAgain: () => void checkAgain(),
  };
}
