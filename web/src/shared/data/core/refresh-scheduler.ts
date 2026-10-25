// Decides when the data core goes to the server. It merges the notifications of a short window,
// joins requests for one resource into one fetch (single-flight), keeps background fetches to a
// few at a time, and fetches the sections a notification touched and nothing else. A stream
// becomes a whole version only through `ResourceStore.commit`, after `readDetail` accepted it.
import type { ProjectId } from '../../api/contracts';
import type { ChangedEvent, DetailSection } from '../api/contracts';
import type { ChangeInvalidator } from './change-invalidator';
import { runDetail } from './detail-fetch';
import {
  applyInvalidation,
  cancelDetail,
  holdBackground,
  resetCache,
} from './invalidation-actions';
import { BACKGROUND_CONCURRENCY, REFRESH_WINDOW_MS } from './limits';
import type { PresentationGate } from './presentation-gate';
import {
  detailId,
  type EnqueueRequest,
  type Flight,
  type SchedulerHost,
  type Item,
  summaryId,
} from './refresh-types';
import type { ResourceStore } from './resource-store';
import { runSummary } from './summary-fetch';
import type { DataAdapter, ResetReason, ResourceKey } from './types';

const SECTION_ORDER: readonly DetailSection[] = ['document', 'history'];

export interface SchedulerOptions {
  adapter: DataAdapter;
  store: ResourceStore;
  gate: PresentationGate;
  invalidator: ChangeInvalidator;
  /** The projects whose Summary the screens are showing. */
  watchedProjects(): Iterable<ProjectId>;
  windowMs?: number;
  concurrency?: number;
}

export interface LoadOptions {
  /**
   * A person asked for it (opening, refresh, save): it starts at once and is not held back by
   * the gate. Otherwise it is a background update.
   */
  immediate?: boolean;
}

export class RefreshScheduler implements SchedulerHost {
  readonly adapter: DataAdapter;
  readonly store: ResourceStore;
  private readonly gate: PresentationGate;
  readonly invalidator: ChangeInvalidator;
  readonly watched: () => Iterable<ProjectId>;
  private readonly windowMs: number;
  private readonly concurrency: number;
  readonly queue = new Map<string, Item>();
  readonly flights = new Map<string, Flight>();
  /** Sections a notification outdated; the Summary does not yet say what version they have. */
  readonly unverified = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private counter = 0;
  /** Read by the fetches, which stop quietly once it is true. */
  disposed = false;
  private readonly offGate: () => void;

  constructor(options: SchedulerOptions) {
    this.adapter = options.adapter;
    this.store = options.store;
    this.gate = options.gate;
    this.invalidator = options.invalidator;
    this.watched = options.watchedProjects;
    this.windowMs = options.windowMs ?? REFRESH_WINDOW_MS;
    this.concurrency = options.concurrency ?? BACKGROUND_CONCURRENCY;
    this.offGate = this.gate.subscribe((event) => {
      if (event === 'held') holdBackground(this);
      else this.pump();
    });
  }

  // ---- requests

  /** Fetches the Summary of a project, or joins the fetch that is already running. */
  loadSummary(projectId: ProjectId, options: LoadOptions = {}): Promise<void> {
    const immediate = options.immediate ?? true;
    const flight = this.flights.get(summaryId(projectId));
    if (flight && !this.queue.has(flight.id)) {
      if (immediate) flight.immediate = true;
      return new Promise((resolve) => flight.waiters.push(resolve));
    }
    return new Promise((resolve) =>
      this.enqueue({
        kind: 'summary',
        projectId,
        key: null,
        sections: [],
        immediate,
        waiters: [resolve],
      }),
    );
  }

  /** Fetches sections of a Detail, or joins the fetch that already covers them. */
  loadDetail(
    key: ResourceKey,
    sections: DetailSection[],
    options: LoadOptions = {},
  ): Promise<void> {
    const immediate = options.immediate ?? true;
    const flight = this.flights.get(detailId(key));
    const covered = flight ? sections.filter((s) => flight.sections.includes(s)) : [];
    const missing = sections.filter((s) => !covered.includes(s));
    const parts: Array<Promise<void>> = [];
    if (flight && covered.length > 0) {
      if (immediate) flight.immediate = true;
      parts.push(new Promise((resolve) => flight.waiters.push(resolve)));
    }
    if (missing.length > 0) {
      parts.push(
        new Promise((resolve) =>
          this.enqueue({
            kind: 'detail',
            projectId: key.projectId,
            key,
            sections: missing,
            immediate,
            waiters: [resolve],
          }),
        ),
      );
    }
    return Promise.all(parts).then(() => {});
  }

  // ---- what the connection reports

  /** A `changed` event. The sequence is checked now; what it changes waits for the gate. */
  onChanged(event: ChangedEvent): void {
    const reason = this.invalidator.observe(event);
    for (const flight of this.flights.values()) {
      if (flight.kind === 'summary' && flight.projectId === event.projectId) {
        flight.recorded.push(event);
      }
    }
    if (reason) {
      this.gate.submit(() => resetCache(this, reason), { key: 'reset' });
    } else {
      this.gate.submit(() =>
        applyInvalidation(this, event.projectId, this.invalidator.apply(event)),
      );
    }
  }

  /** The adapter says the cache can no longer be trusted. */
  onReset(reason: ResetReason): void {
    this.gate.submit(() => resetCache(this, reason), { key: 'reset' });
  }

  /** The subscription is open. Called before the first Summary and again after every reconnect. */
  connected(reconnect: boolean): void {
    if (!reconnect) {
      for (const projectId of this.watched()) void this.loadSummary(projectId);
      return;
    }
    this.invalidator.forgetSequence();
    this.gate.submit(() => resetCache(this, 'reconnected'), { key: 'reset' });
  }

  dispose(): void {
    this.disposed = true;
    this.offGate();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const item of this.queue.values()) for (const w of item.waiters) w();
    this.queue.clear();
    for (const flight of this.flights.values()) flight.controller.abort();
  }

  hasFlight(id: string): boolean {
    return this.flights.has(id);
  }

  cancelDetail(key: ResourceKey): void {
    cancelDetail(this, key);
  }

  // ---- queue

  enqueue(request: EnqueueRequest): void {
    if (this.disposed) {
      for (const w of request.waiters) w();
      return;
    }
    const id = request.key ? detailId(request.key) : summaryId(request.projectId);
    let item = this.queue.get(id);
    if (item) {
      for (const s of request.sections) item.sections.add(s);
      item.immediate = item.immediate || request.immediate;
      item.attempt = Math.max(item.attempt, request.attempt ?? 0);
      item.waiters.push(...request.waiters);
    } else {
      item = {
        id,
        kind: request.kind,
        projectId: request.projectId,
        key: request.key,
        sections: new Set(request.sections),
        immediate: request.immediate,
        ready: false,
        attempt: request.attempt ?? 0,
        waiters: [...request.waiters],
        order: ++this.counter,
      };
      this.queue.set(id, item);
    }
    if (!item.immediate && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        for (const queued of this.queue.values()) queued.ready = true;
        this.pump();
      }, this.windowMs);
    }
    this.pump();
  }

  private priority(item: Item): number {
    if (item.kind === 'summary') return 0;
    return item.key && this.store.isPinned(item.key) ? 1 : 2;
  }

  private pump(): void {
    if (this.disposed) return;
    for (const item of [...this.queue.values()]) {
      if (item.immediate && !this.flights.has(item.id)) this.start(item);
    }
    if (this.gate.blocked) return;
    for (;;) {
      const running = [...this.flights.values()].filter((f) => !f.immediate).length;
      if (running >= this.concurrency) return;
      const next = [...this.queue.values()]
        .filter((i) => i.ready && !this.flights.has(i.id))
        .sort((a, b) => this.priority(a) - this.priority(b) || a.order - b.order)[0];
      if (!next) return;
      this.start(next);
    }
  }

  private start(item: Item): void {
    this.queue.delete(item.id);
    const flight: Flight = {
      id: item.id,
      kind: item.kind,
      projectId: item.projectId,
      key: item.key,
      sections: SECTION_ORDER.filter((s) => item.sections.has(s)),
      immediate: item.immediate,
      attempt: item.attempt,
      controller: new AbortController(),
      waiters: item.waiters,
      superseded: false,
      requeue: false,
      cancelled: false,
      recorded: [],
    };
    this.flights.set(flight.id, flight);
    const run = flight.kind === 'summary' ? runSummary(this, flight) : runDetail(this, flight);
    void run.finally(() => this.finish(flight));
  }

  private finish(flight: Flight): void {
    if (this.flights.get(flight.id) === flight) this.flights.delete(flight.id);
    const waiters = flight.waiters;
    flight.waiters = [];
    for (const w of waiters) w();
    this.pump();
  }
}
