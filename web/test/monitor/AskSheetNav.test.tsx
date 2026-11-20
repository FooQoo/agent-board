import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AskAiSheet } from '../../src/features/messages/ask/AskAi';
import { MonitorView } from '../../src/pages/monitor/View';
import type { MonitorFreshness } from '../../src/pages/monitor/contracts';
import { selectLocale } from '../../src/shared/i18n';
import { PROJECT_A } from '../fixtures';
import { renderWithData as render } from './support';

beforeEach(() => selectLocale('en'));
afterEach(() => cleanup());

const freshness: MonitorFreshness = {
  state: 'fresh',
  lastFetchedAt: '2026-10-12T00:00:00Z',
  snapshotProblems: [],
};

/** The wiring `MonitorScreen` gives the view: the Ask sheet, its open state and its guarded close. */
function Screen() {
  const [asking, setAsking] = useState(false);
  const guard = useRef<((after: () => void) => void) | null>(null);
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
        asking={asking}
        onAsk={() => setAsking(true)}
        onAskClose={(then) => (guard.current ? guard.current(then) : then())}
      />
      {asking && (
        <AskAiSheet projectId={PROJECT_A.id} closeGuard={guard} onClose={() => setAsking(false)} />
      )}
    </>
  );
}

// An open sheet marks the rest of the page hidden for assistive technology; the bar stays tappable.
const bar = () => screen.getByRole('navigation', { name: 'Main navigation', hidden: true });
const navItem = (name: string | RegExp) =>
  within(bar()).getByRole('button', { name, hidden: true });
// The modal sheet sets `pointer-events: none` on the page; phone-nav.css gives the bar its taps
// back, which jsdom does not load, so the check is off for the bar.
const tap = (name: string | RegExp) =>
  userEvent.setup({ pointerEventsCheck: 0 }).click(navItem(name));
const sheet = () => screen.queryByRole('dialog', { name: 'Ask AI' });

describe('the Ask AI sheet and the phone navigation bar', () => {
  it('closes the sheet when a destination is tapped and shows that destination', async () => {
    render(<Screen />);
    await tap('Ask AI');
    expect(sheet()).not.toBeNull();

    await tap(/^Messages/);

    await waitFor(() => expect(sheet()).toBeNull());
    expect(navItem(/^Messages/).getAttribute('aria-current')).toBe('page');
  });

  it('asks before discarding typed text, and stays on the sheet when the person keeps it', async () => {
    render(<Screen />);
    await tap('Ask AI');
    await userEvent.type(screen.getByRole('textbox'), 'Check the login page');

    await tap(/^Messages/);

    const confirm = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull(),
    );
    expect(sheet()).not.toBeNull();
    expect(navItem(/^Messages/).getAttribute('aria-current')).toBeNull();
  });

  it('closes the sheet and shows the destination once the discard is confirmed', async () => {
    render(<Screen />);
    await tap('Ask AI');
    await userEvent.type(screen.getByRole('textbox'), 'Check the login page');
    await tap(/^Messages/);

    const confirm = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Discard and close' }));

    await waitFor(() => expect(sheet()).toBeNull());
    expect(navItem(/^Messages/).getAttribute('aria-current')).toBe('page');
  });
});
