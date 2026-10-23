// The life of the change-notification connection: open it, tell the core when it is open (the
// moment to fetch the Summary, so no change can fall between the fetch and the subscription),
// drop it when it goes silent, reopen it with growing pauses, and let it go while the tab is
// hidden. The transport (EventSource, auth, URL) belongs to the adapter.
import type { ChangedEvent } from '../api/contracts';
import { HEARTBEAT_DEADLINE_MS, RETRY_DELAYS_MS } from './limits';
import type { DataAdapter, ResetReason } from './types';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'hidden' | 'stopped';

export interface VisibilitySource {
  hidden(): boolean;
  subscribe(listener: () => void): () => void;
}

/** The page visibility of the browser; in a place without a document, always visible. */
export const documentVisibility: VisibilitySource = {
  hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  subscribe: (listener) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

export interface ConnectionOptions {
  adapter: DataAdapter;
  onChanged(event: ChangedEvent): void;
  onReset(reason: ResetReason): void;
  /**
   * The subscription is open. `reconnect` is false for the first one of this run; after that
   * (or after a hidden tab) events may have been missed, so the listener fetches the Summary again.
   */
  onConnected(reconnect: boolean): void;
  /** The build ID of the `ready` event. */
  onReady?(build: string): void;
  onPreferences?(payload: unknown): void;
  onState?(state: ConnectionState): void;
  visibility?: VisibilitySource;
  heartbeatMs?: number;
  retryDelaysMs?: readonly number[];
}

export class EventConnection {
  private readonly options: ConnectionOptions;
  private readonly visibility: VisibilitySource;
  private readonly heartbeatMs: number;
  private readonly delays: readonly number[];
  private current: ConnectionState = 'stopped';
  private close: (() => void) | null = null;
  private generation = 0;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryIndex = 0;
  private opened = false;
  private offVisibility: (() => void) | null = null;

  constructor(options: ConnectionOptions) {
    this.options = options;
    this.visibility = options.visibility ?? documentVisibility;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_DEADLINE_MS;
    this.delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  get state(): ConnectionState {
    return this.current;
  }

  start(): void {
    if (this.offVisibility) return;
    this.offVisibility = this.visibility.subscribe(() => this.visibilityChanged());
    if (this.visibility.hidden()) this.setState('hidden');
    else this.connect();
  }

  stop(): void {
    this.offVisibility?.();
    this.offVisibility = null;
    this.drop();
    this.clearRetry();
    this.setState('stopped');
  }

  private setState(state: ConnectionState): void {
    if (this.current === state) return;
    this.current = state;
    this.options.onState?.(state);
  }

  private connect(): void {
    this.drop();
    this.clearRetry();
    this.setState('connecting');
    const generation = ++this.generation;
    const live = (fn: () => void) => () => {
      if (generation === this.generation) fn();
    };
    this.close = this.options.adapter.openEvents({
      onOpen: live(() => {
        this.retryIndex = 0;
        this.setState('connected');
        this.armHeartbeat();
        const reconnect = this.opened;
        this.opened = true;
        this.options.onConnected(reconnect);
      }),
      onChanged: (event) => {
        if (generation !== this.generation) return;
        this.armHeartbeat();
        this.options.onChanged(event);
      },
      onReset: (reason) => {
        if (generation === this.generation) this.options.onReset(reason);
      },
      onHeartbeat: live(() => this.armHeartbeat()),
      onReady: (build) => {
        if (generation !== this.generation) return;
        this.armHeartbeat();
        this.options.onReady?.(build);
      },
      onPreferences: (payload) => {
        if (generation !== this.generation) return;
        this.armHeartbeat();
        this.options.onPreferences?.(payload);
      },
      onClose: live(() => this.fail()),
    });
    // A connection that never opens is as dead as one that falls silent.
    this.armHeartbeat();
  }

  /** The connection broke or went silent: reopen it after a pause. */
  private fail(): void {
    this.drop();
    this.setState('disconnected');
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retry !== null || this.visibility.hidden()) return;
    const delay = this.delays[Math.min(this.retryIndex, this.delays.length - 1)] ?? 30_000;
    this.retryIndex = Math.min(this.retryIndex + 1, this.delays.length - 1);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, delay);
  }

  private visibilityChanged(): void {
    if (this.current === 'stopped') return;
    if (this.visibility.hidden()) {
      this.drop();
      this.clearRetry();
      this.setState('hidden');
    } else if (this.current === 'hidden' || this.current === 'disconnected') {
      this.retryIndex = 0;
      this.connect();
    }
  }

  private armHeartbeat(): void {
    if (this.heartbeat !== null) clearTimeout(this.heartbeat);
    this.heartbeat = setTimeout(() => {
      this.heartbeat = null;
      this.fail();
    }, this.heartbeatMs);
  }

  /** Closes the current subscription; whatever it says afterwards is ignored. */
  private drop(): void {
    this.generation++;
    if (this.heartbeat !== null) clearTimeout(this.heartbeat);
    this.heartbeat = null;
    const close = this.close;
    this.close = null;
    close?.();
  }

  private clearRetry(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
  }
}
