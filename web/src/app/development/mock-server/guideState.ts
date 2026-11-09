import type { GuideLocale } from './guideCards.ts';
import { error } from './wire.ts';

// The first-run guide's state as the sample-data server holds it in memory: the same fields as
// `shared/.internal/onboarding.json` (`src/file_store/onboarding_state.rs`), without the file, its
// lock or its recovery after a crash.

export type GuideStatus =
  | 'unseen'
  | 'offered'
  | 'active'
  | 'closing'
  | 'completed'
  | 'interrupted'
  | 'skipped';

export type GuidePhase =
  | 'samples'
  | 'first-running'
  | 'first-done'
  | 'question'
  | 'second-running'
  | 'second-done'
  | 'complete';

export type GuideTransition =
  | 'first-running'
  | 'first-done'
  | 'ask-question'
  | 'resume-second'
  | 'second-done'
  | 'complete';

export const TRANSITIONS: readonly GuideTransition[] = [
  'first-running',
  'first-done',
  'ask-question',
  'resume-second',
  'second-done',
  'complete',
];

/** One step: the phase it needs, the phase it leads to, and the refusal from any other phase. */
export const STEPS: Record<GuideTransition, { from: GuidePhase; to: GuidePhase; refusal: string }> =
  {
    'first-running': {
      from: 'samples',
      to: 'first-running',
      refusal: 'The first card has already started.',
    },
    'first-done': {
      from: 'first-running',
      to: 'first-done',
      refusal: 'The first card is not running.',
    },
    'ask-question': {
      from: 'first-done',
      to: 'question',
      refusal: 'The first card must finish before the question.',
    },
    'resume-second': {
      from: 'question',
      to: 'second-running',
      refusal: 'The question has not been asked.',
    },
    'second-done': {
      from: 'second-running',
      to: 'second-done',
      refusal: 'The second card is not running.',
    },
    complete: {
      from: 'second-done',
      to: 'complete',
      refusal: 'Both cards must finish before the guide completes.',
    },
  };

export interface GuideRun {
  runId: string;
  attemptId: string;
  projectId: string;
  locale: GuideLocale;
  createdAt: string;
  sampleIds: number[];
  phase: GuidePhase;
  questionRequestId: string | null;
  closingReason: string | null;
}

/** What `GET /api/onboarding` and every guide write answer. */
export interface GuideFile {
  formatVersion: 1;
  revision: number;
  status: GuideStatus;
  owner: { clientId: string; leaseUntil: string } | null;
  run: GuideRun | null;
  appliedCommands: string[];
}

/** How long a tab keeps the guide's lease without a heartbeat. */
export const LEASE_MS = 30_000;
/** Recent command IDs kept for replay. */
const APPLIED_LIMIT = 64;

/** The state of a page that has never shown the guide: every new page starts here. */
export function freshGuide(): GuideFile {
  return {
    formatVersion: 1,
    revision: 0,
    status: 'unseen',
    owner: null,
    run: null,
    appliedCommands: [],
  };
}

export const leaseUntil = (now: string): string =>
  new Date(Date.parse(now) + LEASE_MS).toISOString().replace('.000Z', 'Z');

/** Whether `clientId` holds a lease that is still valid at `now`. */
export function ownedBy(file: GuideFile, clientId: string, now: string): boolean {
  return (
    file.owner !== null &&
    file.owner.clientId === clientId &&
    Date.parse(file.owner.leaseUntil) > Date.parse(now)
  );
}

/** Whether a lease exists and is still valid at `now`, for any tab. */
export function leaseIsLive(file: GuideFile, now: string): boolean {
  return file.owner !== null && Date.parse(file.owner.leaseUntil) > Date.parse(now);
}

/** Remembers a command as applied, keeping only the most recent ones. */
export function remember(file: GuideFile, commandId: string): string[] {
  return [...file.appliedCommands, commandId].slice(-APPLIED_LIMIT);
}

/** Refusals worded as `agboard serve` words them: the specific text first, then the general one. */
export const conflict = (message: string) =>
  error(
    409,
    'onboarding_conflict',
    message,
    "Read the guide's state again, then repeat the step with the current revision.",
  );

export const invalid = (message: string) =>
  error(
    422,
    'onboarding_invalid',
    message,
    "Follow the guide's order: the step does not apply to the current state.",
  );

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The refusal for an ID field that is not 1 to 64 letters, digits, hyphens or underscores. */
export function badId(value: unknown, field: string) {
  if (typeof value === 'string' && ID_PATTERN.test(value)) return null;
  return error(
    422,
    'invalid_value',
    `invalid ${field}.`,
    'Use 1 to 64 letters, digits, hyphens, or underscores.',
  );
}

export const staleRevision = () =>
  conflict('The guide changed since this tab read it. Read it again.');
