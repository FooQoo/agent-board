import type { Choice, ProjectId } from '../../../../shared/api/contracts';
import { WriteError } from '../../../../shared/api/writeErrors';
import {
  type AnswerItem,
  type BandQuestion,
  type AnswersWriter,
  type HeldAnswer,
  isAnswered,
  isWithinLimit,
} from './qa';

/**
 * Why a held answer can no longer be sent: the question was answered elsewhere, withdrawn, or it
 * left the open list and its state is not read yet.
 */
export type ClosedReason = 'answered' | 'withdrawn' | 'gone';

interface ProjectAnswers {
  /** Every question seen open, in the order first seen; a closed one keeps its title. */
  known: Map<string, BandQuestion>;
  held: Map<string, HeldAnswer>;
  closed: Map<string, ClosedReason>;
  /** Sent here and still listed by the last Summary; the band hides them until it is read again. */
  sent: Set<string>;
  sending: boolean;
  failure: string | null;
}

const EMPTY: HeldAnswer = { choiceId: null, choiceLabel: null, text: '' };

/** The questions a refused send names as answered or withdrawn before it. */
/** The questions a refused send names as answered or withdrawn elsewhere; null for any other failure. */
export function conflictsOf(error: unknown): { answered: string[]; withdrawn: string[] } | null {
  if (!(error instanceof WriteError) || error.status !== 409) return null;
  const body = (error.body ?? {}) as { questionAnswered?: unknown; questionWithdrawn?: unknown };
  const ids = (value: unknown) =>
    Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  return { answered: ids(body.questionAnswered), withdrawn: ids(body.questionWithdrawn) };
}

/**
 * The answers a person has given but not sent, per project and question. They live in memory only,
 * so a reload clears them. The PC board and the monitor each keep one book; React reads it through
 * `subscribe` and `revision`.
 */
export class AnswerBook {
  private readonly projects = new Map<ProjectId, ProjectAnswers>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly revision = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private of(projectId: ProjectId): ProjectAnswers {
    let entry = this.projects.get(projectId);
    if (!entry) {
      entry = {
        known: new Map(),
        held: new Map(),
        closed: new Map(),
        sent: new Set(),
        sending: false,
        failure: null,
      };
      this.projects.set(projectId, entry);
    }
    return entry;
  }

  held(projectId: ProjectId, questionId: string): HeldAnswer | null {
    return this.projects.get(projectId)?.held.get(questionId) ?? null;
  }

  private put(projectId: ProjectId, questionId: string, next: HeldAnswer): void {
    const entry = this.of(projectId);
    if (entry.sending) return;
    if (next.choiceId === null && next.text === '') entry.held.delete(questionId);
    else entry.held.set(questionId, next);
    entry.failure = null;
    this.changed();
  }

  setChoice(projectId: ProjectId, questionId: string, choice: Choice | null): void {
    const current = this.held(projectId, questionId) ?? EMPTY;
    this.put(projectId, questionId, {
      ...current,
      choiceId: choice?.id ?? null,
      choiceLabel: choice?.label ?? null,
    });
  }

  setText(projectId: ProjectId, questionId: string, text: string): void {
    const current = this.held(projectId, questionId) ?? EMPTY;
    this.put(projectId, questionId, { ...current, text });
  }

  clear(projectId: ProjectId, questionId: string): void {
    this.put(projectId, questionId, EMPTY);
  }

  closedReason(projectId: ProjectId, questionId: string): ClosedReason | null {
    return this.projects.get(projectId)?.closed.get(questionId) ?? null;
  }

  markClosed(projectId: ProjectId, questionId: string, reason: ClosedReason): void {
    const entry = this.of(projectId);
    if (entry.sent.has(questionId) || entry.closed.get(questionId) === reason) return;
    entry.closed.set(questionId, reason);
    this.changed();
  }

  /** A question seen open before, with the title and cards it had then. */
  known(projectId: ProjectId, questionId: string): BandQuestion | null {
    return this.projects.get(projectId)?.known.get(questionId) ?? null;
  }

  /** The IDs of every question seen open, in the order first seen. */
  knownIds(projectId: ProjectId): string[] {
    return [...(this.projects.get(projectId)?.known.keys() ?? [])];
  }

  /**
   * Compares the held answers with the open questions of a new Summary. A held question that left
   * the list is closed (`gone` until its state is read); the IDs of those are returned so the
   * caller can read them. A sent question that left is forgotten.
   */
  reconcile(projectId: ProjectId, questions: readonly BandQuestion[]): string[] {
    const entry = this.of(projectId);
    for (const question of questions) entry.known.set(question.id, question);
    if (entry.sending) return [];
    const open = new Set(questions.map((question) => question.id));
    let changed = false;
    for (const id of [...entry.sent])
      if (!open.has(id)) {
        entry.sent.delete(id);
        changed = true;
      }
    const left: string[] = [];
    for (const id of entry.held.keys())
      if (!open.has(id) && !entry.closed.has(id)) {
        entry.closed.set(id, 'gone');
        left.push(id);
        changed = true;
      }
    // Forget the closed questions that hold nothing; they are not shown anywhere any more.
    for (const id of [...entry.known.keys()])
      if (!open.has(id) && !entry.held.has(id)) {
        entry.known.delete(id);
        entry.closed.delete(id);
      }
    if (changed) this.changed();
    return left;
  }

  /** Questions with an answer held, sendable or not, in the order they were first answered. */
  heldIds(projectId: ProjectId): string[] {
    const entry = this.projects.get(projectId);
    if (!entry) return [];
    return [...entry.held.entries()].filter(([, held]) => isAnswered(held)).map(([id]) => id);
  }

  /** Held answers that can be sent now: answered, within the limit, and their question still open. */
  sendableIds(projectId: ProjectId): string[] {
    const entry = this.projects.get(projectId);
    if (!entry) return [];
    return this.heldIds(projectId).filter((id) => {
      const held = entry.held.get(id);
      return held !== undefined && isWithinLimit(held) && !entry.closed.has(id);
    });
  }

  isSent(projectId: ProjectId, questionId: string): boolean {
    return this.projects.get(projectId)?.sent.has(questionId) ?? false;
  }

  sending(projectId: ProjectId): boolean {
    return this.projects.get(projectId)?.sending ?? false;
  }

  failure(projectId: ProjectId): string | null {
    return this.projects.get(projectId)?.failure ?? null;
  }

  /** Answers wait to be sent, or are on their way: the screen keeps them (the answer lease). */
  hasUnsent(projectId: ProjectId): boolean {
    return this.sending(projectId) || this.sendableIds(projectId).length > 0;
  }

  /** Any project holds an answer; a page reload would lose it. */
  hasAnyHeld(): boolean {
    return [...this.projects.keys()].some(
      (projectId) => this.sending(projectId) || this.heldIds(projectId).length > 0,
    );
  }

  /** Projects whose answers hold the screen, for the lease. */
  projectsWithUnsent(): ProjectId[] {
    return [...this.projects.keys()].filter((projectId) => this.hasUnsent(projectId));
  }

  /**
   * Sends every sendable answer of the project in one request. On success they are forgotten; on
   * failure they stay, and the questions that a conflict names are closed. `describe` turns the
   * failure into the line the screen shows. `only` limits the send to those questions. Resolves
   * with whether the answers were saved.
   */
  async send(
    projectId: ProjectId,
    write: AnswersWriter,
    describe: (error: unknown) => string,
    only?: ReadonlySet<string>,
  ): Promise<boolean> {
    const entry = this.of(projectId);
    const ids = this.sendableIds(projectId).filter((id) => only === undefined || only.has(id));
    if (entry.sending || ids.length === 0) return false;
    const answers: AnswerItem[] = ids.map((questionId) => {
      const held = entry.held.get(questionId) ?? EMPTY;
      const item: AnswerItem = { questionId };
      if (held.choiceId !== null) item.choiceId = held.choiceId;
      if (held.text.trim() !== '') item.text = held.text;
      return item;
    });
    entry.sending = true;
    entry.failure = null;
    this.changed();
    try {
      await write(projectId, answers);
      for (const id of ids) {
        entry.held.delete(id);
        entry.sent.add(id);
      }
      return true;
    } catch (error) {
      const conflicts = conflictsOf(error);
      for (const id of conflicts?.answered ?? []) entry.closed.set(id, 'answered');
      for (const id of conflicts?.withdrawn ?? []) entry.closed.set(id, 'withdrawn');
      entry.failure = describe(error);
      return false;
    } finally {
      entry.sending = false;
      this.changed();
    }
  }
}
