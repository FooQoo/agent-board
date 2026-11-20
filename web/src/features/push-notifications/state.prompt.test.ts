import { beforeEach, describe, expect, it } from 'vitest';
import {
  readPromptDismissed,
  rememberPromptDismissed,
  shouldPromptForPush,
  type PushSupport,
} from './state';

const standalone: PushSupport = {
  secureContext: true,
  serviceWorker: true,
  pushManager: true,
  notification: true,
  standalone: true,
  ios: true,
};

describe('shouldPromptForPush', () => {
  it('asks in the Home Screen app while nothing is decided', () => {
    expect(shouldPromptForPush(standalone, 'default', 'off', false)).toBe(true);
  });

  it('stays quiet in a browser tab', () => {
    expect(shouldPromptForPush({ ...standalone, standalone: false }, 'default', 'off', false)).toBe(
      false,
    );
  });

  it('stays quiet once the permission is granted or refused', () => {
    expect(shouldPromptForPush(standalone, 'granted', 'off', false)).toBe(false);
    expect(shouldPromptForPush(standalone, 'denied', 'denied', false)).toBe(false);
  });

  it('stays quiet when push is unsupported, already on, or the prompt was seen', () => {
    expect(shouldPromptForPush(standalone, 'default', 'unsupported', false)).toBe(false);
    expect(shouldPromptForPush(standalone, 'default', 'needsDevice', false)).toBe(false);
    expect(shouldPromptForPush(standalone, 'default', 'on', false)).toBe(false);
    expect(shouldPromptForPush(standalone, 'default', 'off', true)).toBe(false);
  });
});

describe('the remembered dismissal', () => {
  beforeEach(() => window.localStorage.clear());

  it('is per device and survives a reload of the page state', () => {
    expect(readPromptDismissed()).toBe(false);
    rememberPromptDismissed();
    expect(readPromptDismissed()).toBe(true);
  });
});
