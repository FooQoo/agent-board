// The entrance of the framework-free data core.
export { ChangeInvalidator, contradictsSummary, type Invalidation } from './change-invalidator';
export { DataCore, type DataCoreOptions } from './data-core';
export {
  type ConnectionOptions,
  type ConnectionState,
  documentVisibility,
  EventConnection,
  type VisibilitySource,
} from './event-connection';
export { LIMITS } from './limits';
export { COOLDOWN_MS, PresentationGate } from './presentation-gate';
export { RefreshScheduler } from './refresh-scheduler';
export { keyOf, ResourceStore, type StoreLimits } from './resource-store';
export { type DetailResult, ndjsonEvents, readDetail, StreamRejected } from './stream-reader';
export type * from './types';
