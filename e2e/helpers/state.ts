import type { Serve } from './skan';

/** What global setup started, for global teardown to stop. Both run in the Playwright process. */
export const state: { serve?: Serve } = {};
