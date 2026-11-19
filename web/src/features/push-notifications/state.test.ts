import { describe, expect, it } from 'vitest';
import { keyBytes, needsHomeScreen, pushView, type PushSupport } from './state';

const full: PushSupport = {
  secureContext: true,
  serviceWorker: true,
  pushManager: true,
  notification: true,
  standalone: true,
  ios: true,
};
const registered = { deviceRegistered: true, publicKey: 'k', subscribed: false };

describe('pushView', () => {
  it('shows nothing until the status is known', () => {
    expect(pushView(full, 'default', null)).toBe('hidden');
  });

  it('explains an unsupported browser, and asks an iPhone tab to use the Home Screen', () => {
    const tab = { ...full, pushManager: false, standalone: false };
    expect(pushView(tab, 'default', registered)).toBe('unsupported');
    expect(needsHomeScreen(tab)).toBe(true);
    const android = { ...tab, ios: false };
    expect(needsHomeScreen(android)).toBe(false);
    expect(needsHomeScreen(full)).toBe(false);
    expect(pushView({ ...full, secureContext: false }, 'default', registered)).toBe('unsupported');
  });

  it('asks a session without a registered device to register first', () => {
    expect(pushView(full, 'default', { deviceRegistered: false })).toBe('needsDevice');
  });

  it('keeps a denied permission apart from the offer to turn on', () => {
    expect(pushView(full, 'denied', registered)).toBe('denied');
    expect(pushView(full, 'default', registered)).toBe('off');
    expect(pushView(full, 'granted', registered)).toBe('off');
  });

  it('is on only while the PC holds a subscription and the permission stays granted', () => {
    const on = { ...registered, subscribed: true };
    expect(pushView(full, 'granted', on)).toBe('on');
    expect(pushView(full, 'default', on)).toBe('off');
  });
});

describe('keyBytes', () => {
  it('decodes base64url text without padding', () => {
    expect(Array.from(keyBytes('BAUG'))).toEqual([4, 5, 6]);
    expect(Array.from(keyBytes('-_8'))).toEqual([251, 255]);
  });
});
