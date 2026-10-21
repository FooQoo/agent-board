export interface PhoneEntrance {
  /** What the phone's browser opens: `<phoneOrigin>/monitor/`. */
  phoneOrigin: string;
  /** The backend's own PC entrance on loopback, with the normal board. */
  readonly pcOrigin: string;
  /** The project of the built-in fixture; empty when the caller supplied the data area. */
  readonly projectId: string;
  /** The loopback address, public host, proof and origin the Edge stand-in forwards with. */
  readonly target: { addr: string; proof: string; host: string; origin: string; local: string };
  rotate(): Promise<void>;
  stopTunnel(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

export function buildPhoneBackend(): string;
export function startPhoneEntrance(home: string, options?: { timeoutMs?: number }): Promise<PhoneEntrance>;
