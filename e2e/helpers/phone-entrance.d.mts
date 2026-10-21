export interface PhoneEntrance {
  /** What the phone's browser opens: `<phoneOrigin>/monitor/`. */
  phoneOrigin: string;
  /** The backend's own PC entrance on loopback, with the normal board. */
  readonly pcOrigin: string;
  /** The project of the built-in fixture; empty when the caller supplied the data area. */
  readonly projectId: string;
  /** The loopback address, public host, passcode and origin the Edge stand-in forwards with. */
  readonly target: { addr: string; passcode: string; host: string; origin: string; local: string };
  /** The passcode of the run, as the PC shows it; it changes whenever the tunnel is replaced. */
  readonly passcode: string;
  /** Type the passcode into the phone page that is asking for it and send it. */
  unlockPage(page: import('@playwright/test').Page): Promise<void>;
  /** Open a phone monitor URL and enter the passcode. */
  open(page: import('@playwright/test').Page, url: string): Promise<import('@playwright/test').Response | null>;
  rotate(): Promise<void>;
  stopTunnel(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

export function buildPhoneBackend(): string;
export function startPhoneEntrance(
  home: string,
  options?: { timeoutMs?: number; warning?: boolean },
): Promise<PhoneEntrance>;
