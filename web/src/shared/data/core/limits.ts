// The cache limits of the data core, in one place. Measure before changing them; there is no TTL.
const MIB = 1024 * 1024;

export const LIMITS = {
  /** Summaries kept, one per project. */
  summaryProjects: 4,
  taskDetail: { count: 60, bytes: 8 * MIB },
  epicDetail: { count: 20, bytes: 4 * MIB },
} as const;

/** How long a change is collected before the fetches start. */
export const REFRESH_WINDOW_MS = 150;
/** Background fetches that may run at once. */
export const BACKGROUND_CONCURRENCY = 2;
/** A connection with no sign of life for this long is dropped and reopened. */
export const HEARTBEAT_DEADLINE_MS = 45_000;
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** Fetches repeated after a response that contradicts a notification or the requested version. */
export const MAX_REFETCH_ATTEMPTS = 3;
