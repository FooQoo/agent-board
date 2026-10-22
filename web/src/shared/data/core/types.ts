// The types the web data layer is built against. The implementations come later; callers and
// adapters agree on these first.
import type { ProjectId } from '../../api/contracts';
import type { ChangedEvent, DetailEvent, DetailSection, Summary } from '../api/contracts';

/** What a cached resource is: a task or an epic of a project. */
export type ResourceKey =
  | { kind: 'task'; projectId: ProjectId; id: number }
  | { kind: 'epic'; projectId: ProjectId; id: string };

/** Where one section of a resource stands in the cache. */
export type SectionState = 'absent' | 'loading' | 'ready' | 'stale' | 'refreshing' | 'error';

export interface DetailRequest {
  resource: ResourceKey;
  sections: DetailSection[];
}

/** What the connection tells its listener. `reset` means the cache can no longer be trusted. */
export interface EventHandlers {
  onChanged(event: ChangedEvent): void;
  onReset(reason: 'seq-gap' | 'instance-changed' | 'unknown-event' | 'reconnected'): void;
  onOpen?(): void;
}

/** The one place the data layer talks to a server: the PC and the monitor each have an adapter. */
export interface DataAdapter {
  fetchSummary(projectId: ProjectId, signal: AbortSignal): Promise<Summary>;
  /** Yields the events of one Detail stream in order; ends after `complete`. */
  streamDetail(request: DetailRequest, signal: AbortSignal): AsyncIterable<DetailEvent>;
  /** Opens the change notifications; the returned function closes them. */
  openEvents(handlers: EventHandlers): () => void;
}
