import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestNotificationDialog } from '../../src/features/notification-settings/events';
import { NotificationHost } from '../../src/features/notification-settings/ui/NotificationHost';
import { MonitorView } from '../../src/pages/monitor/View';
import type { MonitorFreshness } from '../../src/pages/monitor/contracts';
import { selectLocale } from '../../src/shared/i18n';
import type { HeaderSettings } from '../../src/shared/ui/app-header/Header';
import { PROJECT_A } from '../fixtures';
import { renderWithData as render } from './support';

// The sheet reads the saved choices when it opens; here they never arrive, which it shows as loading.
vi.mock('../../src/features/notification-settings/api', () => ({
  loadNotificationSettings: () => new Promise(() => undefined),
  saveNotificationSettings: () => new Promise(() => undefined),
}));

beforeEach(() => {
  selectLocale('en');
  // A phone: the notification dialog is then a bottom sheet, which the bar sits in front of.
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: true,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const freshness: MonitorFreshness = {
  state: 'fresh',
  lastFetchedAt: '2026-10-12T00:00:00Z',
  snapshotProblems: [],
};

/** A settings sheet with the row that, like the real one, closes it and asks for the notifications. */
const settings: HeaderSettings = {
  render: ({ open, onOpenChange }) =>
    open ? (
      <div role="dialog" aria-label="Settings">
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            requestNotificationDialog();
          }}
        >
          Notification settings
        </button>
      </div>
    ) : null,
};

function Screen() {
  return (
    <>
      <MonitorView
        summary={{ todo: 0, doing: 0, done: 0 }}
        todo={[]}
        doing={[]}
        done={[]}
        freshness={freshness}
        onRefresh={() => undefined}
        projectId={PROJECT_A.id}
        messages={[]}
        settings={settings}
      />
      <NotificationHost />
    </>
  );
}

const bar = () => screen.getByRole('navigation', { name: 'Main navigation', hidden: true });
const navItem = (name: string | RegExp) =>
  within(bar()).getByRole('button', { name, hidden: true });
// The modal sheet sets `pointer-events: none` on the page; phone-nav.css gives the bar its taps
// back, which jsdom does not load, so the check is off for the bar.
const tap = (name: string | RegExp) =>
  userEvent.setup({ pointerEventsCheck: 0 }).click(navItem(name));
const notifications = () => screen.queryByRole('dialog', { name: 'Notifications' });

async function openNotifications() {
  await tap('Settings');
  await userEvent
    .setup({ pointerEventsCheck: 0 })
    .click(await screen.findByRole('button', { name: 'Notification settings', hidden: true }));
  await screen.findByRole('dialog', { name: 'Notifications' });
}

describe('the notifications sheet and the phone navigation bar', () => {
  it('closes the sheet when Board is tapped and shows the board', async () => {
    render(<Screen />);
    await openNotifications();

    await tap(/^Board/);

    await waitFor(() => expect(notifications()).toBeNull());
    expect(navItem(/^Board/).getAttribute('aria-current')).toBe('page');
  });

  it('closes the sheet when another destination is tapped', async () => {
    render(<Screen />);
    await openNotifications();

    await tap(/^Messages/);

    await waitFor(() => expect(notifications()).toBeNull());
    expect(navItem(/^Messages/).getAttribute('aria-current')).toBe('page');
  });

  it('leaves the sheet open when nothing on the bar is tapped', async () => {
    render(<Screen />);
    await openNotifications();

    expect(notifications()).not.toBeNull();
  });
});
