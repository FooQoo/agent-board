import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useLayoutEffect, useMemo, useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { SAMPLE_PROJECT, sampleMessagesApi } from '../../features/tasks/messages/messageSamples';
import type { Message } from '../../shared/data/api/contracts';
import { health } from '../../features/resident-sessions/fixtures';
import { ResidentIndicator } from '../../features/resident-sessions/ui/ResidentFooter';
import { unconnectedMonitorReadResolvers } from './contracts';
import { withMonitorFixtureData } from './fixture-provider';
import { MonitorProject } from './MonitorProject';
import { createMonitorFixture, createMonitorFixtureProps } from './mock';
import { createMonitorFixtureAdapter } from './mock-adapter';
import { MonitorView } from './View';

const meta = {
  title: 'Pages/Monitor',
  component: MonitorPageStory,
  parameters: { storyFrame: 'monitor' },
} satisfies Meta<typeof MonitorPageStory>;

type Story = StoryObj<typeof meta>;

function MonitorPageStory({
  epicReadFails = false,
  statusSlot,
}: {
  epicReadFails?: boolean;
  statusSlot?: ReactNode;
}) {
  const fixture = useMemo(() => {
    const value = createMonitorFixture();
    const first = value.tasks.get(1);
    if (first) first.summary.title = 'Mobile drawer example';
    return value;
  }, []);
  const props = useMemo(() => createMonitorFixtureProps(fixture), [fixture]);
  return withMonitorFixtureData(fixture, <MonitorView {...props} statusSlot={statusSlot} />, {
    failEpic: epicReadFails,
  });
}

/** The screen as the app builds it: the data layer reads the Summary, the list is drawn from it. */
function ConnectedProjectStory() {
  const [{ fixture, adapter }] = useState(() => {
    const value = createMonitorFixture();
    return { fixture: value, adapter: createMonitorFixtureAdapter(value) };
  });
  return (
    <MonitorProject
      projectId={fixture.projectId}
      adapter={adapter}
      readResolvers={unconnectedMonitorReadResolvers}
      messagesApi={{
        read: async () => {
          throw new Error('The story has no messages.');
        },
        answer: async () => {
          throw new Error('The story takes no answers.');
        },
        withdraw: async () => {
          throw new Error('The story withdraws nothing.');
        },
      }}
      useBuildReload={() => undefined}
      onNotFound={() => undefined}
    />
  );
}

/** The phone screen with a question, wired as the app wires them. */
function WiredPhoneStory({ onAsk }: { onAsk: () => void }) {
  const fixture = useMemo(() => createMonitorFixture(), []);
  const props = useMemo(() => createMonitorFixtureProps(fixture), [fixture]);
  const messages: Message[] = [
    {
      id: 'Q-13',
      type: 'question',
      from: 'ai',
      to: 'human',
      turn: 'human',
      title: 'Keep password sign-in?',
      createdAt: '2026-11-17T08:20:00.000Z',
      tasks: [26],
      epicId: 'SEARCH-2',
    },
  ];
  return withMonitorFixtureData(
    fixture,
    <MonitorView
      {...props}
      projectId={SAMPLE_PROJECT}
      messages={messages}
      messagesApi={sampleMessagesApi('en')}
      onAsk={onAsk}
    />,
  );
}

export default meta;

/** The monitor opens the mobile drawer with body, acceptance, history, and epic tabs. */
export const DrawerTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Mobile drawer example' }));
    const dialog = within(await within(document.body).findByRole('dialog'));
    const tabs = dialog.getAllByRole('tab');
    await expect(tabs).toHaveLength(5);
    await expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(dialog.getByRole('tab', { name: /History/ }));
    await expect(await dialog.findByText('Created task in Todo.')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(await dialog.findByText('Epic body text')).toBeInTheDocument();
  },
};

/**
 * The status line at the bottom shows the resident agent after the connection state: the tool, a
 * short state word and a dot, display-only. At phone widths it takes the room of the fetch time.
 */
export const ResidentStatusLine: Story = {
  args: {
    statusSlot: (
      <ResidentIndicator health={health({ state: 'running', tool: 'claude-code' })} withState />
    ),
  },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const line = canvasElement.querySelector('.monitor-freshness');
    await expect(line).not.toBeNull();
    const indicator = within(line as HTMLElement).getByRole('img', {
      name: 'Claude Code: Working on a task',
    });
    await expect(indicator).toHaveTextContent('Claude Code');
    await expect(indicator).toHaveTextContent('working');
    await expect(
      within(line as HTMLElement).queryByRole('button', { name: /Claude Code/ }),
    ).toBeNull();
  },
};

/** Nothing launched and auto-start off: the status line shows only the connection state. */
export const NoResidentStatus: Story = {
  args: { statusSlot: <ResidentIndicator health={health({})} withState /> },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.resident-footer')).toBeNull();
  },
};

/** A read failure offers a retry action inside the epic tab. */
export const EpicReadFailure: Story = {
  args: { epicReadFails: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Mobile drawer example' }));
    const dialog = within(await within(document.body).findByRole('dialog'));
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(await dialog.findByText('Could not load the details')).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Retry' })).toBeEnabled();
  },
};

/** A finger on `target`, as a touch event. The lanes watch touch events for the pull. */
function touch(type: 'touchstart' | 'touchmove' | 'touchend', target: Element, y: number) {
  const point = new Touch({ identifier: 1, target, clientX: 100, clientY: y });
  target.dispatchEvent(
    new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: type === 'touchend' ? [] : [point],
      changedTouches: [point],
    }),
  );
}

/** The whole screen reads its Summary from the data layer; pulling a lane down asks again, and no refresh button is left. */
export const ConnectedProject: StoryObj<typeof ConnectedProjectStory> = {
  render: () => <ConnectedProjectStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByRole('button', { name: 'Todo work item 1' });
    await expect(card).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Refresh' })).toBeNull();
    const y = card.getBoundingClientRect().top;
    touch('touchstart', card, y);
    touch('touchmove', card, y + 40);
    touch('touchmove', card, y + 130);
    await expect(await canvas.findByText('Release to refresh')).toBeVisible();
    touch('touchend', card, y + 130);
    await expect(await canvas.findByRole('button', { name: 'Todo work item 1' })).toBeVisible();
  },
};

const body = () => within(document.body);

/** The bar's Ask item reaches the screen's callback. */
export const BarAskAi: StoryObj<typeof WiredPhoneStory> = {
  args: { onAsk: fn() },
  globals: { locale: 'en' },
  render: (args) => <WiredPhoneStory {...args} />,
  play: async ({ canvasElement, args }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Ask AI' }));
    await expect(args.onAsk).toHaveBeenCalledOnce();
  },
};

/**
 * A sheet opened from the bar stands on the bar: the bar is in front of the sheet and its backdrop and
 * stays tappable, the sheet's surface runs to the bottom of the screen behind it while its content ends at
 * the bar's top, and Board closes the sheet.
 */
export const SheetStandsOnBar: StoryObj<typeof WiredPhoneStory> = {
  args: { onAsk: fn() },
  globals: { locale: 'en', width: 'phone-390' },
  render: (args) => (
    <StandaloneInsets>
      <div className="app" data-layout="mobile">
        <WiredPhoneStory {...args} />
      </div>
    </StandaloneInsets>
  ),
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'Main navigation' });
    await userEvent.click(within(nav).getByRole('button', { name: /^Messages/ }));
    const sheet = await body().findByRole('dialog', { name: 'Messages' });
    // The sheet slides in: wait for it to rest before measuring.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const navBox = nav.getBoundingClientRect();
    await expect(
      Math.abs(sheet.getBoundingClientRect().bottom - window.innerHeight),
    ).toBeLessThanOrEqual(1);
    const content = sheet.querySelector<HTMLElement>('.mobile-drawer__content') as HTMLElement;
    await expect(content.getBoundingClientRect().bottom).toBeLessThanOrEqual(navBox.top + 0.5);
    await expect(content.getBoundingClientRect().bottom).toBeGreaterThan(navBox.top - 2);
    // The bar is what a tap on its middle reaches, above the sheet's backdrop, and it takes pointer events.
    const centre = [navBox.left + navBox.width / 2, navBox.top + navBox.height / 2] as const;
    await expect(nav.contains(document.elementFromPoint(...centre))).toBe(true);
    await expect(getComputedStyle(nav).pointerEvents).toBe('auto');
    // A tap on Board closes the sheet. The dialog marks the page behind it aria-hidden, so the bar is
    // found by its hidden role; it is still on screen and tappable.
    await userEvent.click(within(nav).getByRole('button', { name: 'Board', hidden: true }));
    await waitFor(() => expect(body().queryByRole('dialog', { name: 'Messages' })).toBeNull());
  },
};

/** The connected screen opens the Ask AI sheet from the bar. */
export const ConnectedAskAiSheet: StoryObj<typeof ConnectedProjectStory> = {
  render: () => <ConnectedProjectStory />,
  globals: { locale: 'en' },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Ask AI' }));
    await expect(await body().findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
  },
};

/** The bar's Board item, found by class: an open sheet hides the page behind it from the accessibility tree. */
const barItem = (canvasElement: HTMLElement, name: string) =>
  within(canvasElement.querySelector<HTMLElement>('.phone-nav') as HTMLElement).getByText(name);

/** With nothing typed, leaving the Ask sheet from the bar is one tap: no question, and the sheet is gone. */
export const BarLeavesEmptyAsk: StoryObj<typeof ConnectedProjectStory> = {
  render: () => <ConnectedProjectStory />,
  globals: { locale: 'en', width: 'phone-390' },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Ask AI' }));
    await expect(await body().findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
    await userEvent.click(barItem(canvasElement, 'Board'));
    await waitFor(() => expect(body().queryByRole('dialog', { name: 'Ask AI' })).toBeNull());
    await expect(body().queryByRole('dialog', { name: 'Discard changes?' })).toBeNull();
  },
};

/** A typed request is not thrown away by the bar: it asks first, keeping stays on Ask, discarding leaves. */
export const BarAsksBeforeDiscardingAsk: StoryObj<typeof ConnectedProjectStory> = {
  render: () => <ConnectedProjectStory />,
  globals: { locale: 'en', width: 'phone-390' },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Ask AI' }));
    const ask = await body().findByRole('dialog', { name: 'Ask AI' });
    await userEvent.type(within(ask).getByRole('textbox'), 'Please check the build');
    await userEvent.click(barItem(canvasElement, 'Messages'));
    const question = await body().findByRole('dialog', { name: 'Discard changes?' });
    // Keep: the question closes, Ask stays with its text, and the bar went nowhere.
    await userEvent.click(within(question).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() =>
      expect(body().queryByRole('dialog', { name: 'Discard changes?' })).toBeNull(),
    );
    await expect(body().getByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
    await expect(within(ask).getByRole('textbox')).toHaveValue('Please check the build');
    await expect(body().queryByRole('dialog', { name: 'Messages' })).toBeNull();
    // Discard: Ask closes, and the sheet the person chose opens.
    await userEvent.click(barItem(canvasElement, 'Messages'));
    await userEvent.click(
      within(await body().findByRole('dialog', { name: 'Discard changes?' })).getByRole('button', {
        name: 'Discard and close',
      }),
    );
    await waitFor(() => expect(body().queryByRole('dialog', { name: 'Ask AI' })).toBeNull());
    await expect(await body().findByRole('dialog', { name: 'Messages' })).toBeInTheDocument();
  },
};

/** Sets the safe-area variables of an iPhone with a Dynamic Island in portrait, which Storybook cannot report through env(). */
function StandaloneInsets({ children, top = 59 }: { children: ReactNode; top?: number }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--safe-top', `${top}px`);
    root.style.setProperty('--safe-bottom', '34px');
    return () => {
      root.style.removeProperty('--safe-top');
      root.style.removeProperty('--safe-bottom');
    };
  }, [top]);
  return (
    <>
      {children}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          height: top,
          background: 'rgb(0 0 0 / 18%)',
          pointerEvents: 'none',
          zIndex: 2000,
          top: 0,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          height: 34,
          background: 'rgb(0 0 0 / 18%)',
          pointerEvents: 'none',
          zIndex: 2000,
          bottom: 0,
        }}
      />
    </>
  );
}

function iphoneViewport(name: string, width: number, height: number) {
  return { name, styles: { width: `${width}px`, height: `${height}px` }, type: 'mobile' as const };
}

/** Checks that the whole header row sits below the status bar, with a gap,. */
async function expectHeaderBelowStatusBar(canvasElement: HTMLElement, top: number) {
  const header = canvasElement.querySelector<HTMLElement>('.monitor-shell > .header');
  await expect(header).not.toBeNull();
  const rect = (header as HTMLElement).getBoundingClientRect();
  await expect(rect.top).toBeGreaterThanOrEqual(top + 8);
}

function standaloneAt(top: number, name: string): StoryObj<typeof WiredPhoneStory> {
  return {
    name,
    globals: { locale: 'en' },
    render: (args) => (
      <StandaloneInsets top={top}>
        <div className="app" data-layout="mobile">
          <WiredPhoneStory {...args} />
        </div>
      </StandaloneInsets>
    ),
    play: async ({ canvasElement }) => {
      await expectHeaderBelowStatusBar(canvasElement, top);
    },
  };
}

/** A Dynamic Island iPhone (393 by 852, 59px status bar): the header row starts a gap below the bar. */
export const StandaloneIphoneDynamicIsland: StoryObj<typeof WiredPhoneStory> = {
  ...standaloneAt(59, 'Standalone iPhone 393x852'),
  parameters: {
    viewport: { options: { iphone15pro: iphoneViewport('iPhone 15 Pro', 393, 852) } },
  },
  globals: { locale: 'en', viewport: { value: 'iphone15pro' } },
};

/** A notched iPhone (390 by 844, 47px status bar). */
export const StandaloneIphoneNotch: StoryObj<typeof WiredPhoneStory> = {
  ...standaloneAt(47, 'Standalone iPhone 390x844'),
  parameters: {
    viewport: { options: { iphone14: iphoneViewport('iPhone 14', 390, 844) } },
  },
  globals: { locale: 'en', viewport: { value: 'iphone14' } },
};

/** The Home Screen app with the status bar (59px) and the home indicator (34px) kept clear: the header starts below the bar and the bottom dock ends above the indicator. */
export const StandaloneSafeArea: StoryObj<typeof WiredPhoneStory> = {
  globals: { locale: 'en' },
  render: (args) => (
    <StandaloneInsets>
      {/* The frame the app puts around the phone screen: it must not add the insets a second time. */}
      <div className="app" data-layout="mobile">
        <WiredPhoneStory {...args} />
      </div>
    </StandaloneInsets>
  ),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector<HTMLElement>('.app');
    await expect(Number.parseFloat(getComputedStyle(frame as HTMLElement).paddingTop)).toBe(0);
    await expect(Number.parseFloat(getComputedStyle(frame as HTMLElement).paddingBottom)).toBe(0);
    const shell = canvasElement.querySelector<HTMLElement>('.monitor-shell');
    await expect(shell).not.toBeNull();
    const style = getComputedStyle(shell as HTMLElement);
    await expect(Number.parseFloat(style.paddingTop)).toBeGreaterThanOrEqual(59 + 8);
    // The floating dock keeps its own margin above the home indicator.
    const nav = canvasElement.querySelector<HTMLElement>('.phone-nav');
    await expect(nav).not.toBeNull();
    await expect(
      Number.parseFloat(getComputedStyle(nav as HTMLElement).marginBottom),
    ).toBeGreaterThanOrEqual(34);
    const bottom = (nav as HTMLElement).getBoundingClientRect().bottom;
    await expect(bottom).toBeLessThanOrEqual(window.innerHeight);
  },
};
