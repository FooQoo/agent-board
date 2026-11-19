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

/** The result of asking for the permission and subscribing. */
export type EnableResult = 'on' | 'denied' | 'failed';

/**
 * Ask for the permission, subscribe with the board's public key, and hand the subscription to the
 * PC. Call it from a tap: a browser may refuse the permission prompt otherwise. When the PC does
 * not accept the subscription the browser's one is dropped again, so the two never disagree.
 */
export async function enablePush(publicKey: string): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'failed';
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      }));
    try {
      await putPushSubscription(subscription.toJSON());
    } catch (error) {
      await subscription.unsubscribe();
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
    const registration = await navigator.serviceWorker.ready;
    await (await registration.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // The PC no longer sends to it; the browser's copy is harmless.
  }
  return true;
}
