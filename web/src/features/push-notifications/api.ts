import { authHeaders, FetchError } from '../../shared/api/http';
import type { PushStatus } from './state';

const STATUS_URL = '/api/remote/push';
const SUBSCRIPTION_URL = '/api/remote/push/subscription';

async function failure(response: Response): Promise<FetchError> {
  let code: string | null = null;
  try {
    code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? null;
  } catch {
    // The body was not JSON.
  }
  return new FetchError(
    `${response.url} failed with status ${response.status}`,
    response.status,
    code,
  );
}

/** Whether this session can subscribe, the public key to use, and whether it already has. */
export async function getPushStatus(): Promise<PushStatus> {
  const response = await fetch(STATUS_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as PushStatus;
}

/** Keep the browser's subscription (`PushSubscription.toJSON()`) for this device. */
export async function putPushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  const response = await fetch(SUBSCRIPTION_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(subscription),
  });
  if (!response.ok) throw await failure(response);
}

export async function deletePushSubscription(): Promise<void> {
  const response = await fetch(SUBSCRIPTION_URL, { method: 'DELETE', headers: authHeaders() });
  if (!response.ok) throw await failure(response);
}
