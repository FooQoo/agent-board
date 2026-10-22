// The types the web data layer is built against. The implementations come later; callers and
// adapters agree on these first.
import type { ProjectId } from '../../api/contracts';
import type {
  BlockKind,
  ChangedEvent,
  DetailEvent,
  DetailImage,
  DetailSection,
  Summary,
} from '../api/contracts';

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

/** Why the connection tells its listener that the cache can no longer be trusted. */
export type ResetReason = 'seq-gap' | 'instance-changed' | 'unknown-event' | 'reconnected';

/** What the connection tells its listener. `reset` means the cache can no longer be trusted. */
export interface EventHandlers {
  onChanged(event: ChangedEvent): void;
  onReset(reason: ResetReason): void;
  /** The subscription is established; the first Summary may be fetched. */
  onOpen?(): void;
  /** The server closed the stream or it failed; the connection reconnects. */
  onClose?(): void;
  /** Any sign of life from the server (a heartbeat comment, for one). */
  onHeartbeat?(): void;
  /** The `ready` event: the build ID of the server. */
  onReady?(build: string): void;
  /** The `preferences` event; the app applies it. */
  onPreferences?(payload: unknown): void;
}

/** The one place the data layer talks to a server: the PC and the monitor each have an adapter. */
export interface DataAdapter {
  fetchSummary(projectId: ProjectId, signal: AbortSignal): Promise<Summary>;
  /** Yields the events of one Detail stream in order; ends after `complete`. */
  streamDetail(request: DetailRequest, signal: AbortSignal): AsyncIterable<DetailEvent>;
  /** Opens the change notifications; the returned function closes them. */
  openEvents(handlers: EventHandlers): () => void;
}

// ---- What a cache holds

export interface DetailBlock {
  kind: BlockKind;
  text: string;
  images?: DetailImage[];
}

export interface DetailAcceptance {
  id: string;
  text: string;
  done: boolean;
}

export interface DetailHistoryItem {
  at: string;
  reason: string;
}

/** The `document` section: the body blocks and, for a task, the acceptance conditions. */
export interface DocumentData {
  blocks: DetailBlock[];
  acceptance: DetailAcceptance[];
}

/** The `history` section. */
export interface HistoryData {
  items: DetailHistoryItem[];
}

export interface SectionDataMap {
  document: DocumentData;
  history: HistoryData;
}

/** The cached state of one section. `partial` is what a running stream has received so far. */
export interface SectionSnapshot<S extends DetailSection = DetailSection> {
  state: SectionState;
  data: SectionDataMap[S] | null;
  partial: SectionDataMap[S] | null;
  version: string | null;
  error: Error | null;
  pinned: boolean;
  bytes: number;
}

export interface ResourceSnapshot {
  document: SectionSnapshot<'document'>;
  history: SectionSnapshot<'history'>;
}

export interface SummarySnapshot {
  state: SectionState;
  data: Summary | null;
  version: string | null;
  error: Error | null;
  bytes: number;
}
