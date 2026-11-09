import {
  answered,
  archiveSamples,
  askCard,
  createSample,
  findSample,
  finishCard,
  setRunning,
  startCard,
} from './guideCards.ts';
import {
  type GuideFile,
  type GuideTransition,
  STEPS,
  TRANSITIONS,
  badId,
  conflict,
  freshGuide,
  invalid,
  leaseIsLive,
  leaseUntil,
  ownedBy,
  remember,
  staleRevision,
} from './guideState.ts';
import type { MockContext, MockResponse, Routes } from './types.ts';
import { forbidden, invalidJson, json, parseBody, projectNotFound } from './wire.ts';

// The first-run guide's routes, as `agboard serve` answers them (`src/server/api/onboarding.rs` and
// `src/file_store/ops/onboarding/`): the lease, the start, the scripted steps, and the finish,
// abort and recovery. The guide plays the AI that moves the two sample cards. Its state lives in
// memory, so every new page (and every reset) offers the guide again from the beginning.

const RUN_PATH =
  /^\/api\/projects\/([^/]+)\/onboarding\/(start|([0-9a-f]{32})\/(advance|finish|abort))$/;

export interface MockGuide {
  routes: Routes;
  /** Back to a guide that has never been shown, as a new page starts. */
  reset(): void;
}

export function createGuide(): MockGuide {
  let file = freshGuide();
  // IDs of runs and questions: 32 lowercase hexadecimal characters, as the server makes them.
  let serial = 0;
  const nextHex = () => (++serial).toString(16).padStart(32, '0');
  const answer = (next: GuideFile): MockResponse => {
    file = next;
    return json(200, file);
  };

  /** Archives the run's cards and marks the guide interrupted, as a reload or the exit does. */
  const endRun = (context: MockContext, reason: string): GuideFile => {
    const { run } = file;
    if (run) archiveSamples(context, run.projectId, run.runId);
    return {
      ...file,
      status: 'interrupted',
      owner: null,
      run: run ? { ...run, closingReason: reason } : null,
      revision: file.revision + 1,
    };
  };

  const claim = (context: MockContext, input: Record<string, unknown>, replay: boolean) => {
    const clientId = input.clientId;
    const refused = badId(clientId, 'clientId');
    if (refused || typeof clientId !== 'string') return refused ?? invalidJson();
    const now = context.now();
    if (file.revision !== input.expectedRevision) return staleRevision();
    if (leaseIsLive(file, now) && !ownedBy(file, clientId, now))
      return conflict('Another tab is showing the guide.');
    // The tab that ran the guide was reloaded or closed: the run is taken back first.
    if (file.status === 'active') file = endRun(context, 'Recovered after a reload.');
    const { status } = file;
    if (status === 'closing') return conflict('The guide is closing.');
    if ((status === 'completed' || status === 'skipped') && !replay)
      return conflict('The guide has already been shown in this data area.');
    return answer({
      ...file,
      status: 'offered',
      owner: { clientId, leaseUntil: leaseUntil(now) },
      revision: file.revision + 1,
    });
  };

  /** Creates whichever of the run's two samples are missing; an existing one is reused. */
  const ensureSamples = (context: MockContext): MockResponse => {
    const run = file.run;
    if (!run) return conflict('No guide run is active.');
    const ids = [...run.sampleIds];
    for (const ordinal of [1, 2] as const) {
      if (ids.length >= ordinal) continue;
      const id =
        findSample(context, run.projectId, run.runId, ordinal) ??
        createSample(context, run.projectId, run.runId, ordinal, run.locale);
      if (id === null) return projectNotFound();
      ids.push(id);
      file = { ...file, run: { ...run, sampleIds: [...ids] }, revision: file.revision + 1 };
    }
    return json(200, file);
  };

  const start = (context: MockContext, projectId: string, input: Record<string, unknown>) => {
    const { clientId, attemptId, locale } = input;
    const refused = badId(attemptId, 'attemptId');
    if (refused || typeof attemptId !== 'string') return refused ?? invalidJson();
    if (locale !== 'en' && locale !== 'ja')
      return invalid('The guide speaks English (en) or Japanese (ja).');
    const now = context.now();
    const holds = typeof clientId === 'string' && ownedBy(file, clientId, now);
    const current = file.run;
    if (
      file.status === 'active' &&
      current?.attemptId === attemptId &&
      current.projectId === projectId
    ) {
      // Same attempt again: finish creating the cards, if any are missing.
      return holds ? ensureSamples(context) : conflict('This tab no longer holds the guide.');
    }
    if (file.revision !== input.expectedRevision) return staleRevision();
    if (file.status !== 'offered' || !holds)
      return conflict('The guide is not offered to this tab.');
    file = {
      ...file,
      status: 'active',
      run: {
        runId: nextHex(),
        attemptId,
        projectId,
        locale,
        createdAt: now,
        sampleIds: [],
        phase: 'samples',
        questionRequestId: null,
        closingReason: null,
      },
      appliedCommands: [],
      revision: file.revision + 1,
    };
    return ensureSamples(context);
  };

  /** The card work of one step; a refusal when the step cannot be taken. */
  const work = (
    context: MockContext,
    transition: GuideTransition,
  ): MockResponse | string | null => {
    const run = file.run;
    const [first, second] = run?.sampleIds ?? [];
    if (!run || first === undefined || second === undefined)
      return conflict("The guide's sample cards are not all created yet.");
    const project = run.projectId;
    if (transition === 'first-running') startCard(context, project, first);
    else if (transition === 'first-done') finishCard(context, project, first);
    else if (transition === 'ask-question')
      return askCard(context, project, second, run.locale, nextHex());
    else if (transition === 'resume-second') {
      const request = run.questionRequestId;
      if (!request) return invalid('The question has not been asked.');
      if (!answered(context, project, second, request))
        return invalid('The answer is not saved yet.');
      setRunning(context, project, second);
    } else if (transition === 'second-done') finishCard(context, project, second);
    return null;
  };

  const advance = (context: MockContext, input: Record<string, unknown>) => {
    const transition = input.transition as GuideTransition;
    if (!TRANSITIONS.includes(transition)) return invalid('The step is not one of the guide.');
    const step = STEPS[transition];
    if (file.run?.phase !== step.from) return invalid(step.refusal);
    const result = work(context, transition);
    if (result !== null && typeof result !== 'string') return result;
    const run = file.run;
    return answer({
      ...file,
      run: { ...run, phase: step.to, questionRequestId: result ?? run.questionRequestId },
      revision: file.revision + 1,
      appliedCommands: remember(file, String(input.commandId)),
    });
  };

  const finish = (context: MockContext, input: Record<string, unknown>) => {
    const run = file.run;
    if (!run || (run.phase !== 'complete' && file.status !== 'closing'))
      return invalid('The guide has not completed.');
    archiveSamples(context, run.projectId, run.runId);
    return answer({
      ...file,
      status: 'completed',
      owner: null,
      revision: file.revision + 1,
      appliedCommands: remember(file, String(input.commandId)),
    });
  };

  /** A command on the active run: the checks every advance, finish and abort share. */
  const runCommand = (
    context: MockContext,
    projectId: string,
    runId: string,
    action: string,
    input: Record<string, unknown>,
  ): MockResponse => {
    const refused = badId(input.commandId, 'commandId');
    if (refused) return refused;
    if (file.appliedCommands.includes(String(input.commandId))) return json(200, file);
    if (file.revision !== input.expectedRevision) return staleRevision();
    if (!ownedBy(file, String(input.clientId), context.now()))
      return conflict('This tab no longer holds the guide.');
    if (file.run?.runId !== runId || file.run.projectId !== projectId)
      return conflict('This guide run is not the active one.');
    if (action === 'abort')
      return answer({
        ...endRun(context, 'Ended by the user.'),
        appliedCommands: remember(file, String(input.commandId)),
      });
    if (action === 'finish') return finish(context, input);
    if (file.status !== 'active') return conflict('The guide run is not active for this tab.');
    return advance(context, input);
  };

  const globalRoutes = (context: MockContext, path: string, input: Record<string, unknown>) => {
    const now = context.now();
    const clientId = String(input.clientId);
    if (path === 'claim') return claim(context, input, false);
    if (path === 'replay') return claim(context, input, true);
    if (path === 'heartbeat') {
      if (!ownedBy(file, clientId, now)) return conflict('This tab no longer holds the guide.');
      // A heartbeat only extends the lease; it does not change the revision.
      return answer({ ...file, owner: { clientId, leaseUntil: leaseUntil(now) } });
    }
    if (path === 'skip') {
      const refused = badId(input.commandId, 'commandId');
      if (refused) return refused;
      if (file.appliedCommands.includes(String(input.commandId))) return json(200, file);
      if (file.revision !== input.expectedRevision) return staleRevision();
      if (!ownedBy(file, clientId, now) || file.status !== 'offered')
        return conflict('The guide is not offered to this tab.');
      return answer({
        ...file,
        status: 'skipped',
        owner: null,
        revision: file.revision + 1,
        appliedCommands: remember(file, String(input.commandId)),
      });
    }
    if (path === 'recover') {
      const running = file.status === 'active' || file.status === 'closing';
      if (running && !leaseIsLive(file, now))
        file = endRun(context, 'Recovered after the tab was closed.');
      return json(200, file);
    }
    return null;
  };

  const routes: Routes = (context, request) => {
    const path = request.url.pathname;
    if (request.method === 'GET' && path === '/api/onboarding') return json(200, file);
    const global = /^\/api\/onboarding\/(claim|replay|heartbeat|skip|recover)$/.exec(path);
    const run = RUN_PATH.exec(path);
    if (request.method !== 'POST' || (!global && !run)) return null;
    if (!request.token) return forbidden();
    const input = parseBody(request.body);
    if (!input) return invalidJson();
    if (global) return globalRoutes(context, global[1] ?? '', input);
    const projectId = run?.[1] ?? '';
    if (!context.boards()[projectId]) return projectNotFound();
    if (run?.[2] === 'start') return start(context, projectId, input);
    return runCommand(context, projectId, run?.[3] ?? '', run?.[4] ?? '', input);
  };

  return {
    routes,
    reset() {
      file = freshGuide();
    },
  };
}
