/** What this browser can do about Web Push, read once from the page. */
export interface PushSupport {
  /** The page is on HTTPS (or localhost), which a service worker and push require. */
  secureContext: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  /** The board was opened from the Home Screen icon, not from a browser tab. */
  standalone: boolean;
  ios: boolean;
}

export type PushPermission = 'default' | 'granted' | 'denied';

/** What `GET /api/remote/push` answers. */
export interface PushStatus {
  /** False when this session has no registered device, so it cannot subscribe. */
  deviceRegistered: boolean;
  publicKey?: string;
  subscribed?: boolean;
}

/**
 * What the settings row shows.
 *
 * - `hidden`: nothing to offer (the page has no entrance session, or the status could not be read).
 * - `unsupported`: this browser cannot receive push; on an iPhone, the board must be added to the
 *   Home Screen first.
 * - `needsDevice`: the session was opened without a registered device.
 * - `denied`: the user refused the permission; the board works without notifications.
 * - `off`: it can be turned on. `on`: it is on.
 */
export type PushView = 'hidden' | 'unsupported' | 'needsDevice' | 'denied' | 'off' | 'on';

export function readSupport(): PushSupport {
  const ua = navigator.userAgent;
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    secureContext: window.isSecureContext,
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    standalone: nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches,
    ios: /iPhone|iPad|iPod/.test(ua),
  };
}

export function canPush(support: PushSupport): boolean {
  return (
    support.secureContext && support.serviceWorker && support.pushManager && support.notification
  );
}

/** On an iPhone that has not opened the board from the Home Screen, the fix is to add it. */
export function needsHomeScreen(support: PushSupport): boolean {
  return support.ios && !support.standalone && !canPush(support);
}

export function pushView(
  support: PushSupport,
  permission: PushPermission,
  status: PushStatus | null,
): PushView {
  if (status === null) return 'hidden';
  if (!canPush(support)) return 'unsupported';
  if (!status.deviceRegistered) return 'needsDevice';
  if (permission === 'denied') return 'denied';
  // A subscription kept on the PC is only useful while the browser still holds its own.
  return status.subscribed === true && permission === 'granted' ? 'on' : 'off';
}

/**
 * Whether to offer the turn-on prompt: only in the Home Screen app, while this device has neither
 * granted nor refused the permission and holds no subscription, and only until the user has seen it.
 */
export function shouldPromptForPush(
  support: PushSupport,
  permission: PushPermission,
  view: PushView,
  dismissed: boolean,
): boolean {
  return support.standalone && permission === 'default' && view === 'off' && !dismissed;
}

const PROMPT_DISMISSED_KEY = 'agboard.pushPromptDismissed';

/** Whether this device already saw the prompt. Blocked storage reads as seen, so it never nags. */
export function readPromptDismissed(): boolean {
  try {
    return window.localStorage.getItem(PROMPT_DISMISSED_KEY) !== null;
  } catch {
    return true;
  }
}

export function rememberPromptDismissed(): void {
  try {
    window.localStorage.setItem(PROMPT_DISMISSED_KEY, '1');
  } catch {
    // The prompt may show again next time; the settings row still works.
  }
}

/** The key as bytes, for `PushManager.subscribe` (it takes base64url text only as bytes). */
export function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}
