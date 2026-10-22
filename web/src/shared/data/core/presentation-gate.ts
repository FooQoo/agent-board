// Keeps automatic updates from changing the screen while a drawer or a modal is open, and for
// a while after it closes. Holders `acquire` the gate; an update `submit`ted meanwhile waits and
// is applied together when the last holder has been gone for `COOLDOWN_MS`. The connection stays
// open and the data is not fetched during that time.

/** How long updates wait after the last holder lets go. */
export const COOLDOWN_MS = 3_000;

export type GateEvent = 'held' | 'open';

export interface SubmitOptions {
  /** Manual refresh, save, answer and sign-in expiry skip the wait. */
  immediate?: boolean;
  /** A later update with the same key replaces a pending one. */
  key?: string;
}

interface Pending {
  key: string | null;
  update: () => void;
}

export class PresentationGate {
  private readonly cooldownMs: number;
  private readonly holders = new Set<symbol>();
  private pending: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(event: GateEvent) => void>();

  constructor(options: { cooldownMs?: number } = {}) {
    this.cooldownMs = options.cooldownMs ?? COOLDOWN_MS;
  }

  /** Something is open now. */
  get held(): boolean {
    return this.holders.size > 0;
  }

  /** Updates wait: something is open, or it closed less than the cooldown ago. */
  get blocked(): boolean {
    return this.holders.size > 0 || this.timer !== null;
  }

  /** Holds the gate for `token` (a name for debugging); call the result to let go. */
  acquire(_token: string): () => void {
    const handle = Symbol('hold');
    const wasBlocked = this.blocked;
    this.holders.add(handle);
    this.cancelTimer();
    if (!wasBlocked) this.emit('held');
    return () => {
      if (!this.holders.delete(handle)) return;
      if (this.holders.size === 0) this.startTimer();
    };
  }

  submit(update: () => void, options: SubmitOptions = {}): void {
    if (options.immediate || !this.blocked) {
      update();
      return;
    }
    const key = options.key ?? null;
    if (key !== null) this.pending = this.pending.filter((p) => p.key !== key);
    this.pending.push({ key, update });
  }

  subscribe(listener: (event: GateEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.cancelTimer();
    this.pending = [];
    this.holders.clear();
    this.listeners.clear();
  }

  private startTimer(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      const batch = this.pending;
      this.pending = [];
      for (const { update } of batch) update();
      this.emit('open');
    }, this.cooldownMs);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(event: GateEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
