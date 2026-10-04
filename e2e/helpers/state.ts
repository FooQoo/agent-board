import type { Serve } from './agboard';

/** What global setup started, for global teardown to stop. Both run in the Playwright process. */
export const state: { serve?: Serve } = {};
