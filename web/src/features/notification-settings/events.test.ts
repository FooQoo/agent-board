import { describe, expect, it, vi } from 'vitest';
import { onNotificationDialogRequest, requestNotificationDialog } from './events';

describe('notification dialog requests', () => {
  it('reaches each listener until it stops listening', () => {
    const listener = vi.fn();
    const stop = onNotificationDialogRequest(listener);
    requestNotificationDialog();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    requestNotificationDialog();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
