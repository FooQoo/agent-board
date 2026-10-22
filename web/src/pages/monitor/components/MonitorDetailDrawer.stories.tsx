import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { Epic } from '../../../shared/api/contracts';
import type { MonitorDetailTab, MonitorReadResolvers } from '../contracts';
import type { EpicReadState } from '../hooks/useMonitorDetailDrawer';
import { createMonitorFixtureProps } from '../mock';
import { MonitorDetailDrawer } from './MonitorDetailDrawer';

const meta = {
  title: 'Pages/Monitor/Components/MonitorDetailDrawer',
  component: DrawerStory,
  parameters: { storyFrame: 'monitor' },
} satisfies Meta<typeof DrawerStory>;

type Story = StoryObj<typeof meta>;

const epic: Epic = {
  id: 'MOB-1',
  name: 'Mobile work',
  color: '#4466aa',
  isDraft: false,
  document: '---\nname: Mobile work\n---\nEpic body text',
  body: 'Epic body text',
  priority: [],
  priorityError: false,
  attachments: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
};

const resolvers: MonitorReadResolvers = {
  attachmentUrl: (_projectId, _taskId, id) => `/task/${id}`,
  epicAttachmentUrl: (_projectId, _epicId, id) => `/epic/${id}`,
  getEpics: async () => [epic],
};

const DIAGRAM = '```mermaid\nflowchart LR\n  A[Todo] --> B[Doing] --> C[Done]\n```';
const IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#9ab"/></svg>',
)}`;

/** A long document with diagrams, a table, code, and images: the load the drawer must carry. */
const heavyBody = (parts: string) =>
  [
    ...Array.from({ length: 40 }, (_, index) => [
      `## Section ${index + 1}`,
      'A paragraph with **bold**, `code`, and a [link](https://example.com) that wraps over several lines of a narrow phone screen.',
      parts.includes('table') ? '| Column | Value |\n| --- | --- |\n| one | 1 |\n| two | 2 |' : 'x',
      index % 10 === 0 && parts.includes('mermaid')
        ? DIAGRAM
        : parts.includes('code')
          ? '```ts\nconst answer = 42;\n```'
          : 'y',
    ]).flat(),
  ].join('\n\n');

function DrawerStory({
  epicState = 'loaded',
  heavy = false,
  startOpen = true,
  parts = 'mermaid,table,code,images,text',
}: {
  epicState?: 'loaded' | 'error';
  heavy?: boolean;
  startOpen?: boolean;
  parts?: string;
}) {
  const item = createMonitorFixtureProps().todo[0];
  const [tab, setTab] = useState<MonitorDetailTab>('description');
  const [open, setOpen] = useState(startOpen);
  if (!item) return null;
  item.task = {
    ...item.task,
    title: 'Mobile drawer example',
    body: heavy ? heavyBody(parts) : 'Task description for the mobile monitor.',
    attachments:
      heavy && parts.includes('images')
        ? Array.from({ length: 6 }, (_, index) => ({
            id: `img${index}`,
            name: `image-${index}.svg`,
            mediaType: 'image/svg+xml',
            size: 1,
            createdAt: '2026-10-01T00:00:00Z',
          }))
        : item.task.attachments,
    epic: { id: epic.id, name: epic.name, color: epic.color },
  };
  const epicRead: EpicReadState =
    epicState === 'loaded'
      ? { status: 'loaded', epic }
      : { status: 'error', cause: new Error('offline') };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open details
      </button>
      <MonitorDetailDrawer
        item={item}
        open={open}
        tab={tab}
        epicRead={epicRead}
        onOpenChange={setOpen}
        onTabChange={setTab}
        onRetryEpic={fn()}
        resolvers={heavy ? { ...resolvers, attachmentUrl: () => IMAGE } : resolvers}
      />
    </>
  );
}

export default meta;

/** The drawer keeps all four linked panels mounted and presents loaded epic content. */
export const FourTabs: Story = {
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    const tabs = dialog.getAllByRole('tab');
    await expect(tabs).toHaveLength(4);
    await expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(dialog.getByRole('tab', { name: /History/ }));
    await expect(dialog.getByText('Created task in Todo.')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(await dialog.findByText('Epic body text')).toBeInTheDocument();
  },
};

/** Epic read errors remain visible and expose the retry callback. */
export const EpicError: Story = {
  args: { epicState: 'error' },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(dialog.getByText('Could not load this epic.')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
  },
};

/** A long document with diagrams and images, closed at start: the case to open and close repeatedly. */
export const HeavyContent: Story = {
  args: { heavy: true, startOpen: false, parts: 'mermaid table code images text' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open details' }));
    const dialog = within(await within(document.body).findByRole('dialog'));
    await expect(await dialog.findByText('Section 40')).toBeInTheDocument();
    await expect(dialog.getAllByRole('img').length).toBeGreaterThanOrEqual(6);
  },
};
