import { deletePushSubscription, putPushSubscription } from './api';
import { keyBytes } from './state';

/** The service worker the entrance serves; registered once the session is open. */
export const SERVICE_WORKER_URL = '/sw.js';

/** Register the worker when the browser allows it; a failure leaves the board as it was. */
export async function registerServiceWorker(): Promise<void> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
  } catch {
    // Without a worker the board still works; the notifications row says it is not available.
  }
}

/** How long to wait for the worker to activate before giving up, so a tap never hangs. */
export const READY_TIMEOUT_MS = 10_000;

/**
 * The active registration, or a rejection. `serviceWorker.ready` never rejects, and stays pending
 * when registration failed, so check there is a registration first and bound the wait.
 */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL))) {
    throw new Error('The service worker is not registered.');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('The service worker did not activate.')),
      READY_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the browser itself holds a push subscription; false when it cannot be read. */
export async function hasBrowserSubscription(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
    return (await registration?.pushManager.getSubscription()) != null;
  } catch {
    return false;
  }
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (current === null || current.byteLength !== wanted.length) return false;
  const bytes = new Uint8Array(current);
  return wanted.every((value, index) => bytes[index] === value);
}

/** The result of asking for the permission and subscribing. */
export type EnableResult = 'on' | 'denied' | 'failed';

/**
 * Ask for the permission, subscribe with the board's public key, and hand the subscription to the
 * PC. Call it from a tap: a browser may refuse the permission prompt otherwise. A subscription
 * made for another key (the board's key was regenerated) is replaced. When the PC does not accept
 * the subscription, or its answer is lost, the browser's one is dropped and the PC's is asked to
 * forget it, so the two never disagree.
 */
export async function enablePush(publicKey: string): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'failed';
  try {
    const registration = await readyRegistration();
    const key = keyBytes(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    try {
      await putPushSubscription(subscription.toJSON());
    } catch (error) {
      // The PC may have saved it before the answer was lost: reconcile both copies.
      await subscription.unsubscribe().catch(() => undefined);
      await deletePushSubscription().catch(() => undefined);
      throw error;
    }
    return 'on';
  } catch {
    return 'failed';
  }
}

/** Forget the subscription on the PC, then in the browser. True when the PC no longer holds it. */
export async function disablePush(): Promise<boolean> {
  try {
    await deletePushSubscription();
  } catch {
    return false;
  }
  try {
    const registration = await readyRegistration();
    await (await registration.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // The PC no longer sends to it; the browser's copy is harmless.
  }
  return true;
}
