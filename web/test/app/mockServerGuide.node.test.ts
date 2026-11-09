// @vitest-environment node
// The first-run guide of the sample-data server: the whole run, the answer that resumes the second
// card, the skip, the exit, and the checks on revisions, leases and the order of the steps.
import { describe, expect, it } from 'vitest';
import type { MockServer } from '../../src/app/development/mock-server/server';
import { bodyOf, PROJECT, send, start, taskOf } from './mockServerCases';

interface Guide {
  revision: number;
  status: string;
  owner: { clientId: string; leaseUntil: string } | null;
  run: {
    runId: string;
    locale: string;
    sampleIds: number[];
    phase: string;
    questionRequestId: string | null;
  } | null;
}

const CLIENT = 'tab-1';
let serial = 0;
const commandId = () => `command-${++serial}`;

function post(server: MockServer, url: string, body: unknown) {
  return send(server, { method: 'POST', url, body: JSON.stringify(body) });
}

const read = (server: MockServer) => bodyOf<Guide>(send(server, { url: '/api/onboarding' }));

function claim(server: MockServer): Guide {
  return bodyOf<Guide>(
    post(server, '/api/onboarding/claim', {
      clientId: CLIENT,
      expectedRevision: read(server).revision,
    }),
  );
}

function begin(server: MockServer, locale: 'en' | 'ja' = 'en'): Guide {
  const offered = claim(server);
  return bodyOf<Guide>(
    post(server, `/api/projects/${PROJECT}/onboarding/start`, {
      clientId: CLIENT,
      attemptId: 'attempt-1',
      expectedRevision: offered.revision,
      locale,
    }),
  );
}

function step(server: MockServer, transition: string, command = commandId()) {
  const current = read(server);
  return post(server, `/api/projects/${PROJECT}/onboarding/${current.run?.runId}/advance`, {
    clientId: CLIENT,
    expectedRevision: current.revision,
    commandId: command,
    transition,
  });
}

function command(server: MockServer, action: 'finish' | 'abort') {
  const current = read(server);
  return post(server, `/api/projects/${PROJECT}/onboarding/${current.run?.runId}/${action}`, {
    clientId: CLIENT,
    expectedRevision: current.revision,
    commandId: commandId(),
  });
}

function answerQuestion(server: MockServer, id: number) {
  return post(server, `/api/projects/${PROJECT}/tasks/${id}/answer`, {
    requestId: taskOf(server, id).pendingRequestId,
    choiceId: 'brief',
  });
}

describe('first-run guide in the sample-data server', () => {
  it('offers the guide to a new page', () => {
    const { server } = start();
    expect(read(server)).toMatchObject({ status: 'unseen', revision: 0, run: null });
    expect(claim(server)).toMatchObject({ status: 'offered', owner: { clientId: CLIENT } });
  });

  it('runs every phase, takes the answer, and archives the samples', () => {
    const { server, events } = start();
    const started = begin(server);
    expect(started.status).toBe('active');
    expect(started.run?.phase).toBe('samples');
    const [first, second] = started.run?.sampleIds ?? [];
    expect([first, second]).toEqual([18, 19]);
    expect(taskOf(server, 18)).toMatchObject({
      title: 'Sample: follow a task',
      taskStatus: 'todo',
      assignee: 'ai',
      onboardingSample: { runId: started.run?.runId, ordinal: 1 },
      acceptance: [{ id: 'AC-1', done: false }],
    });

    expect(bodyOf<Guide>(step(server, 'first-running')).run?.phase).toBe('first-running');
    expect(taskOf(server, 18)).toMatchObject({ taskStatus: 'doing', agentStatus: 'running' });

    expect(bodyOf<Guide>(step(server, 'first-done')).run?.phase).toBe('first-done');
    // The condition is met, and the automatic Done moves the card.
    expect(taskOf(server, 18)).toMatchObject({ taskStatus: 'done', agentStatus: 'idle' });

    const asked = bodyOf<Guide>(step(server, 'ask-question'));
    expect(asked.run?.phase).toBe('question');
    expect(taskOf(server, 19)).toMatchObject({
      taskStatus: 'doing',
      agentStatus: 'pending',
      pendingReason: 'Which explanation is easier to read?',
      pendingRequestId: asked.run?.questionRequestId,
      pendingChoices: [
        { id: 'brief', label: 'Keep it brief' },
        { id: 'detailed', label: 'Include more context' },
      ],
    });

    // The guide does not resume before the answer is saved.
    expect(bodyOf(step(server, 'resume-second'))).toMatchObject({
      error: { code: 'onboarding_invalid', message: 'The answer is not saved yet.' },
    });
    expect(answerQuestion(server, 19).status).toBe(200);
    expect(bodyOf<Guide>(step(server, 'resume-second')).run?.phase).toBe('second-running');
    expect(taskOf(server, 19)).toMatchObject({ taskStatus: 'doing', agentStatus: 'running' });

    expect(bodyOf<Guide>(step(server, 'second-done')).run?.phase).toBe('second-done');
    expect(taskOf(server, 19).taskStatus).toBe('done');
    expect(bodyOf<Guide>(step(server, 'complete')).run?.phase).toBe('complete');

    const finished = bodyOf<Guide>(command(server, 'finish'));
    expect(finished).toMatchObject({ status: 'completed', owner: null });
    expect(taskOf(server, 18).archivedAt).toBeTruthy();
    expect(taskOf(server, 19).archivedAt).toBeTruthy();
    // Each card step reached the page as a change of its cards.
    expect(events.some((event) => event.changes.some((c) => c.id === 19))).toBe(true);
    // A completed guide is not offered again, but the settings can replay it.
    const done = read(server);
    expect(
      post(server, '/api/onboarding/claim', { clientId: CLIENT, expectedRevision: done.revision })
        .status,
    ).toBe(409);
    expect(
      bodyOf<Guide>(
        post(server, '/api/onboarding/replay', {
          clientId: CLIENT,
          expectedRevision: done.revision,
        }),
      ).status,
    ).toBe('offered');
  });

  it('writes the samples and the question in Japanese', () => {
    const { server } = start();
    begin(server, 'ja');
    expect(taskOf(server, 18).title).toBe('サンプル：使い方を確認する');
    expect(taskOf(server, 19).title).toBe('サンプル：案内の見せ方を選ぶ');
    step(server, 'first-running');
    step(server, 'first-done');
    step(server, 'ask-question');
    expect(taskOf(server, 19)).toMatchObject({
      pendingReason: '案内の文章は、どちらが読みやすいですか？',
      pendingChoices: [
        { id: 'brief', label: '短く、要点だけ' },
        { id: 'detailed', label: '背景も含めて詳しく' },
      ],
    });
    expect(taskOf(server, 18).history.at(-1)?.reason).toBe('すべての受入条件を達成しました。');
  });

  it('skips without creating a card', () => {
    const { server } = start();
    const offered = claim(server);
    const skipped = post(server, '/api/onboarding/skip', {
      clientId: CLIENT,
      expectedRevision: offered.revision,
      commandId: commandId(),
    });
    expect(bodyOf<Guide>(skipped)).toMatchObject({ status: 'skipped', owner: null });
    expect(() => taskOf(server, 18)).toThrow();
  });

  it('archives the samples when the user leaves the guide', () => {
    const { server } = start();
    begin(server);
    step(server, 'first-running');
    expect(bodyOf<Guide>(command(server, 'abort')).status).toBe('interrupted');
    expect(taskOf(server, 18).archivedAt).toBeTruthy();
    expect(taskOf(server, 19).archivedAt).toBeTruthy();
  });

  it('refuses a stale revision and a step out of order, and repeats nothing', () => {
    const { server } = start();
    begin(server);
    const current = read(server);
    const stale = post(
      server,
      `/api/projects/${PROJECT}/onboarding/${current.run?.runId}/advance`,
      {
        clientId: CLIENT,
        expectedRevision: current.revision - 1,
        commandId: commandId(),
        transition: 'first-running',
      },
    );
    expect(bodyOf(stale)).toMatchObject({ error: { code: 'onboarding_conflict' } });
    expect(step(server, 'first-done').status).toBe(422);
    const repeated = commandId();
    const once = bodyOf<Guide>(step(server, 'first-running', repeated));
    // The same command again answers the state as it is.
    expect(bodyOf<Guide>(step(server, 'first-running', repeated)).revision).toBe(once.revision);
  });

  it('starts over after a reset, as a new page does', () => {
    const { server } = start();
    begin(server);
    send(server, { method: 'POST', url: '/api/__mock/reset' });
    expect(read(server)).toMatchObject({ status: 'unseen', run: null });
    expect(() => taskOf(server, 18)).toThrow();
  });
});
