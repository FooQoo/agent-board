// The data core as one object: the store, the gate, the scheduler and the connection, wired
// together. A framework binding (React) needs only this and an adapter.
import type { ProjectId } from '../../api/contracts';
import type { DetailSection } from '../api/contracts';
import { ChangeInvalidator } from './change-invalidator';
import { type ConnectionState, EventConnection, type VisibilitySource } from './event-connection';
import { PresentationGate } from './presentation-gate';
import { RefreshScheduler } from './refresh-scheduler';
import { ResourceStore, type StoreLimits } from './resource-store';
import type { DataAdapter, ResourceKey } from './types';

export interface DataCoreOptions {
  adapter: DataAdapter;
  limits?: StoreLimits;
  visibility?: VisibilitySource;
  /** The build ID of the server's `ready` event. */
  onReady?(build: string): void;
  onPreferences?(payload: unknown): void;
  onConnectionState?(state: ConnectionState): void;
}

export class DataCore {
  readonly store: ResourceStore;
  readonly gate: PresentationGate;
  readonly scheduler: RefreshScheduler;
  readonly connection: EventConnection;
  private readonly watched = new Map<ProjectId, number>();
  private started = false;

  constructor(options: DataCoreOptions) {
    this.store = new ResourceStore(options.limits);
    this.gate = new PresentationGate();
    const invalidator = new ChangeInvalidator(this.store, {
      isActiveProject: (id) => this.watched.has(id),
    });
    this.scheduler = new RefreshScheduler({
      adapter: options.adapter,
      store: this.store,
      gate: this.gate,
      invalidator,
      watchedProjects: () => [...this.watched.keys()],
    });
    this.connection = new EventConnection({
      adapter: options.adapter,
      visibility: options.visibility,
      onChanged: (event) => this.scheduler.onChanged(event),
      onReset: (reason) => this.scheduler.onReset(reason),
      onConnected: (reconnect) => this.scheduler.connected(reconnect),
      onReady: options.onReady,
      onPreferences: options.onPreferences,
      onState: (state) => {
        options.onConnectionState?.(state);
        // Without a connection nothing will fetch the Summary, so a screen is not left empty.
        if (state === 'disconnected' || state === 'hidden') this.loadMissingSummaries();
      },
    });
  }

  /** Opens the connection. Summaries wanted before this wait for the subscription. */
  start(): void {
    this.started = true;
    this.connection.start();
  }

  /** Closes the connection; `start` opens it again. The cache stays. */
  stop(): void {
    this.connection.stop();
  }

  dispose(): void {
    this.connection.stop();
    this.scheduler.dispose();
    this.gate.dispose();
  }

  /**
   * A screen shows this project's Summary. Its change notifications are followed while at least
   * one screen watches. Returns the function that ends the watch.
   */
  watchProject(projectId: ProjectId): () => void {
    this.watched.set(projectId, (this.watched.get(projectId) ?? 0) + 1);
    this.store.touchSummary(projectId);
    // While the connection is opening, `connected` fetches the Summary after the subscription.
    const waiting = this.connection.state === 'connecting' || !this.started;
    if (!waiting) this.loadSummaryIfNeeded(projectId);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      const left = (this.watched.get(projectId) ?? 1) - 1;
      if (left > 0) {
        this.watched.set(projectId, left);
        return;
      }
      this.watched.delete(projectId);
      this.markProjectStale(projectId);
    };
  }

  /** A person asked for the Summary again (refresh, after a save or an answer). */
  refreshSummary(projectId: ProjectId): Promise<void> {
    return this.scheduler.loadSummary(projectId, { immediate: true });
  }

  /**
   * A screen shows a Detail. It stays in the cache while shown, and the sections that are not
   * whole yet are fetched. Returns the function that ends it.
   */
  openDetail(key: ResourceKey, sections: DetailSection[]): () => void {
    const unpin = this.store.pin(key);
    this.store.touch(key);
    const missing = sections.filter((s) => {
      const state = this.store.getSection(key, s).state;
      return state === 'absent' || state === 'error' || state === 'stale';
    });
    if (missing.length > 0) void this.scheduler.loadDetail(key, missing, { immediate: true });
    return unpin;
  }

  /** A person asked for the Detail again. */
  refreshDetail(key: ResourceKey, sections?: DetailSection[]): Promise<void> {
    const cached = this.store.cachedSections(key);
    const wanted = sections ?? (cached.length > 0 ? cached : (['document', 'history'] as const));
    return this.scheduler.loadDetail(key, [...wanted], { immediate: true });
  }

  private loadSummaryIfNeeded(projectId: ProjectId): void {
    const state = this.store.getSummary(projectId).state;
    if (state === 'absent' || state === 'error' || state === 'stale') {
      void this.scheduler.loadSummary(projectId, { immediate: true });
    }
  }

  private loadMissingSummaries(): void {
    for (const projectId of this.watched.keys()) {
      if (this.store.getSummary(projectId).state === 'absent') {
        void this.scheduler.loadSummary(projectId, { immediate: true });
      }
    }
  }

  /** Nobody follows this project's notifications now, so what it holds may be out of date. */
  private markProjectStale(projectId: ProjectId): void {
    this.store.markSummaryStale(projectId);
    for (const key of this.store.cachedKeys(projectId)) {
      for (const section of this.store.cachedSections(key)) this.store.markStale(key, section);
    }
  }
}
