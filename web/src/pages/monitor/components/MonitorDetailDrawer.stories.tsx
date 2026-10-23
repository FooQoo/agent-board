import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import type { MonitorDetailTab, MonitorReadResolvers } from '../contracts';
import { withMonitorFixtureData } from '../fixture-provider';
import { createMonitorFixture, createMonitorFixtureProps, type MonitorFixture } from '../mock';
import type { FixtureAdapterOptions } from '../mock-adapter';
import { MonitorDetailDrawer } from './MonitorDetailDrawer';

const meta = {
  title: 'Pages/Monitor/Components/MonitorDetailDrawer',
  component: DrawerStory,
  parameters: { storyFrame: 'monitor' },
} satisfies Meta<typeof DrawerStory>;

type Story = StoryObj<typeof meta>;

const IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#9ab"/></svg>',
)}`;

const resolvers: MonitorReadResolvers = {
  attachmentUrl: () => IMAGE,
  epicAttachmentUrl: () => IMAGE,
};

const DIAGRAM = '```mermaid\nflowchart LR\n  A[Todo] --> B[Doing] --> C[Done]\n```\n';
const imageId = (index: number) => String(index).padStart(32, '0');

/** A long document with diagrams, a table, code, and images: the load the drawer must carry. */
function heavyBlocks() {
  return Array.from({ length: 40 }, (_, index) => [
    {
      kind: 'markdown' as const,
      text: `## Section ${index + 1}\n\nA paragraph with **bold**, \`code\`, and a [link](#section-1) that wraps over several lines of a narrow phone screen.\n`,
    },
    {
      kind: 'markdown' as const,
      text: '| Column | Value |\n| --- | --- |\n| one | 1 |\n| two | 2 |\n',
    },
    index % 10 === 0
      ? { kind: 'mermaid' as const, text: DIAGRAM }
      : { kind: 'markdown' as const, text: '```ts\nconst answer = 42;\n```\n' },
    ...(index < 6
      ? [{ kind: 'markdown' as const, text: `![image ${index}](attachment:${imageId(index)})\n` }]
      : []),
  ]).flat();
}

function DrawerStory({
  heavy = false,
  startOpen = true,
  options = {},
}: {
  heavy?: boolean;
  startOpen?: boolean;
  options?: FixtureAdapterOptions;
}) {
  const [tab, setTab] = useState<MonitorDetailTab>('description');
  const [open, setOpen] = useState(startOpen);
  const { fixture, item } = useMemo(() => {
    const value: MonitorFixture = createMonitorFixture();
    const first = value.tasks.get(1);
    if (first) {
      first.summary.title = 'Mobile drawer example';
      if (heavy) first.blocks = heavyBlocks();
    }
    return { fixture: value, item: createMonitorFixtureProps(value).todo[0] };
  }, [heavy]);
  if (!item) return null;
  return withMonitorFixtureData(
    fixture,
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open details
      </button>
      <MonitorDetailDrawer
        item={item}
        open={open}
        tab={tab}
        onOpenChange={setOpen}
        onTabChange={setTab}
        resolvers={resolvers}
      />
    </>,
    options,
  );
}

export default meta;

/** The drawer shows its frame at once and mounts only the active tab; each tab reads what it needs. */
export const FourTabs: Story = {
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    const tabs = dialog.getAllByRole('tab');
    await expect(tabs).toHaveLength(4);
    await expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await expect(await dialog.findByText('Work')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('tab', { name: /History/ }));
    await expect(await dialog.findByText('Created task in Todo.')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(await dialog.findByText('Epic body text')).toBeInTheDocument();
  },
};

/** An epic read error stays visible in the epic tab and can be tried again. */
export const EpicError: Story = {
  args: { options: { failEpic: true } },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(await dialog.findByText('Could not load the details')).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Retry' })).toBeEnabled();
  },
};

/** The body is still being read: the frame is shown and the body is a placeholder. */
export const LoadingDetail: Story = {
  args: { options: { detailDelayMs: 600_000 } },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    await expect(dialog.getAllByRole('tab')).toHaveLength(4);
    await expect(await dialog.findByRole('status', { name: 'Loading details…' })).toBeVisible();
  },
};

/** Part of the body has arrived; a note says more will follow. */
export const ArrivingDetail: Story = {
  args: { options: { stallAfter: 4 } },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    // The body and the conditions tabs both show the document while it arrives (the neighbour is drawn too).
    await expect((await dialog.findAllByText(/Still receiving this document/))[0]).toBeVisible();
    await expect(await dialog.findByText('Work')).toBeInTheDocument();
  },
};

/** The body could not be read: the frame stays and the error offers a retry. */
export const DetailFailure: Story = {
  args: { options: { failDetail: true } },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    await expect(await dialog.findByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Retry' })).toBeEnabled();
    await expect(dialog.getAllByRole('tab')).toHaveLength(4);
  },
};

/** A long document with diagrams and images, closed at start: the case to open and close repeatedly. */
export const HeavyContent: Story = {
  args: { heavy: true, startOpen: false },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open details' }));
    const dialog = within(await within(document.body).findByRole('dialog'));
    await expect(await dialog.findByText('Section 1')).toBeInTheDocument();
    await expect((await dialog.findAllByRole('img')).length).toBeGreaterThanOrEqual(1);
  },
};
