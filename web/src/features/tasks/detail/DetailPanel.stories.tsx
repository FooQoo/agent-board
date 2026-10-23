import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import {
  FIXED_NOW,
  makeEpic,
  makeProject,
  makeTask,
  SAMPLE_IMAGE_URL,
} from '../../../../.storybook/support/fixtures';
import { detailData } from '../../../../.storybook/support/detailData';
import { DetailPanel } from './DetailPanel';

// The card's attachment is listed but its picture URL is the product's, which Stories do not reach.
// A missing picture is therefore the state these Stories show, as the card shows it when it is gone.
const ATTACHMENT = '0123456789abcdef0123456789abcdef';
const PROJECT = makeProject();
const EPIC = makeEpic({ id: 'e1a2b3c4d5e6f708192a3b4c5d6e7f80', name: 'Sample epic' });

const DESCRIPTION = `Intro paragraph for the card.

## Background

The parser keeps the typed text. See ![Sample chart](attachment:${ATTACHMENT}).

## Steps

| Step | Result |
|---|---|
| Parse | ok |
| Save | ok |

## Flow

\`\`\`mermaid
flowchart TD
  Start --> Finish
\`\`\``;

const meta = {
  title: 'Task/Detail/DetailPanel',
  component: DetailPanel,
  decorators: [detailData],
  args: {
    projectId: PROJECT.id,
    task: sampleCard(),
    onClose: fn(),
    onRemove: fn(async () => true),
  },
} satisfies Meta<typeof DetailPanel>;

function sampleCard(overrides: Parameters<typeof makeTask>[0] = { id: 7 }) {
  return makeTask({
    title: 'Parser notes',
    description: DESCRIPTION,
    attachments: [
      {
        id: ATTACHMENT,
        name: 'sample-chart.png',
        mediaType: 'image/png',
        size: 512,
        createdAt: FIXED_NOW,
      },
    ],
    ...overrides,
  });
}

const CONDITIONS = [
  { id: 'AC-1', text: 'Parser handles empty input', done: true },
  { id: 'AC-2', text: 'Errors are shown in the dialog', done: true },
  { id: 'AC-3', text: 'Retry keeps the typed text', done: true },
  { id: 'AC-4', text: 'Saved order is kept', done: false },
  { id: 'AC-5', text: 'Locale switch updates the labels', done: false },
];

export default meta;
type Story = StoryObj<typeof meta>;

/** Before a card is chosen, the panel asks for one. */
export const NoCard: Story = {
  args: { task: null },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByText('Select a task to see its details.'),
    ).toBeInTheDocument();
  },
};

/** A card as the board shows it: header, status, the description as chapters and image attachments. */
export const Card: Story = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    expect(view.getByRole('heading', { name: 'Parser notes' })).toBeInTheDocument();
    await waitFor(
      () => expect(view.getByRole('heading', { name: 'Background' })).toBeInTheDocument(),
      { timeout: 10000 },
    );
    await waitFor(() => expect(canvasElement.querySelector('.md-mermaid svg')).not.toBeNull(), {
      timeout: 10000,
    });
    expect(canvasElement.querySelector('.md-scroll table')).not.toBeNull();
    expect(canvasElement.querySelector('.detail-attachments')).not.toBeNull();
    expect(canvasElement.querySelector('.detail-evidence')).toBeNull();
  },
};

/** Owned attachment URLs resolve for both Markdown images and the card's attachment list. */
export const AttachmentAvailable: Story = {
  args: { attachmentUrl: () => SAMPLE_IMAGE_URL },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const pictures = canvasElement.querySelectorAll<HTMLImageElement>(
        '.detail-attachments img, .md__image-picture',
      );
      expect(pictures.length).toBeGreaterThan(0);
      expect([...pictures].every((picture) => picture.naturalWidth > 0)).toBe(true);
    });
  },
};

/** The same card on a phone: the table scrolls inside its frame and the actions stay in the header. */
export const CardPhone: Story = {
  globals: { width: 'phone-390' },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    expect(view.getByRole('heading', { name: 'Parser notes' })).toBeInTheDocument();
    expect(canvasElement.querySelector('.detail__close')).not.toBeNull();
  },
};

/** A draft: the banner says agents cannot work on it until it is finalized. */
export const Draft: Story = {
  args: { task: sampleCard({ id: 8, isDraft: true }), onEdit: fn() },
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement);
    expect(canvasElement.querySelector('.detail__draft')).not.toBeNull();

    for (const tab of [/^Description/, /^Conditions/, /^History/, /^Epic/]) {
      await userEvent.click(view.getByRole('tab', { name: tab }));
      await userEvent.click(view.getByRole('button', { name: 'Edit task' }));
      expect(args.onEdit).toHaveBeenLastCalledWith(args.task);
    }
    expectActionIconSpacing(canvasElement);
  },
};

/** A draft on a phone: its edit, archive, and close icons keep equal spacing. */
export const DraftPhone: Story = {
  args: { task: sampleCard({ id: 8, isDraft: true }) },
  globals: { width: 'phone-390' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.detail__draft')).not.toBeNull();
    expectActionIconSpacing(canvasElement);
  },
};

function expectActionIconSpacing(canvasElement: HTMLElement) {
  const icons = [
    ...canvasElement.querySelectorAll<SVGElement>(
      '.detail__toolbar > button svg, .detail__close svg',
    ),
  ];
  expect(icons).toHaveLength(3);
  const centers = icons.map((icon) => {
    const bounds = icon.getBoundingClientRect();
    return bounds.left + bounds.width / 2;
  });
  const [first, second, third] = centers;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('Expected three action icons');
  }
  expect(Math.abs(second - first - (third - second))).toBeLessThan(0.1);
}

/** The archive view, where a restore failed: the failure is shown above the body. */
export const ArchivedRestoreFailed: Story = {
  args: { archived: true, restoreFailed: true, onRestore: fn() },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'Could not restore the task. Try again.',
    );
  },
};

/** The format defects of this card's files are shown; the defects of other cards are not. */
export const Problems: Story = {
  args: {
    problems: [
      {
        file: `projects/${PROJECT.id}/tasks/7/TASK.md`,
        field: 'acceptance',
        reason: 'the id is repeated',
      },
      { file: 'projects/other/tasks/9/TASK.md', field: '', reason: 'another card' },
    ],
  },
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole('alert');
    expect(alert).toHaveTextContent('the id is repeated');
    expect(canvasElement.textContent).not.toContain('another card');
  },
};

/** A card whose frontmatter cannot be read: the body says so and the reason is listed. */
export const Unreadable: Story = {
  args: {
    task: sampleCard({ id: 7, acceptanceError: true }),
    problems: [
      {
        file: `projects/${PROJECT.id}/tasks/7/TASK.md`,
        field: 'acceptance',
        reason: 'invalid YAML',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Acceptance conditions cannot be read',
    );
    expect(canvasElement.textContent).toContain('invalid YAML');
  },
};

/** The history tab lists the card's events in order. */
export const TabHistory: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /^History/ }));
    expect(canvasElement.querySelector('.detail__viewport:not([hidden])')?.textContent).toContain(
      'Created task in Todo.',
    );
  },
};

/** The conditions tab shows the card's completion conditions read-only, with their count. */
export const TabConditions: Story = {
  args: { task: sampleCard({ id: 7, acceptance: CONDITIONS }) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: 'Conditions' }));
    const panel = canvasElement.querySelector('.detail__viewport:not([hidden])');
    expect(panel?.querySelectorAll('.acceptance-view__item').length).toBe(5);
    expect(panel?.textContent).toContain('3 / 5');
  },
};

/** The epic tab shows the card's epic once the project's epics are known. */
export const TabEpicReady: Story = {
  args: {
    task: sampleCard({ id: 7, epic: { id: EPIC.id, name: EPIC.name, color: EPIC.color } }),
    epics: [EPIC],
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: 'Epic' }));
    await waitFor(() =>
      expect(canvasElement.querySelector('.detail__viewport:not([hidden])')?.textContent).toContain(
        'A synthetic epic for Stories.',
      ),
    );
  },
};

/** While the epics load, the epic tab says so. */
export const TabEpicLoading: Story = {
  args: {
    task: sampleCard({ id: 7, epic: { id: EPIC.id, name: EPIC.name, color: EPIC.color } }),
    epics: undefined,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: 'Epic' }));
    expect(canvasElement.querySelector('.detail__viewport:not([hidden])')?.textContent).toContain(
      'Loading the epic…',
    );
  },
};

/** When the epics cannot be read, the tab offers to try again. */
export const TabEpicFailed: Story = {
  args: {
    task: sampleCard({ id: 7, epic: { id: EPIC.id, name: EPIC.name, color: EPIC.color } }),
    epicsFailed: true,
    onRetryEpics: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement);
    await userEvent.click(view.getByRole('tab', { name: 'Epic' }));
    expect(view.getByRole('alert')).toHaveTextContent('The epic could not be read.');
    await userEvent.click(view.getByRole('button', { name: 'Try again' }));
    expect(args.onRetryEpics).toHaveBeenCalledTimes(1);
  },
};

/** A card without an epic says so on the epic tab. */
export const TabEpicNone: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: 'Epic' }));
    const notice = canvasElement.querySelector('.detail__viewport:not([hidden]) .detail__empty');
    expect(notice?.textContent).toContain('This task belongs to no epic.');
    expect(notice && getComputedStyle(notice).fontSize).toBe('13px');
  },
};

/** The frame and the tabs are shown at once; the text is a skeleton until the first part arrives. */
export const DocumentLoading: Story = {
  parameters: { detailFixture: { stallAfter: 1 } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    expect(view.getByRole('heading', { level: 2, name: 'Parser notes' })).toBeInTheDocument();
    expect(view.getByRole('tab', { name: 'Description', selected: true })).toBeInTheDocument();
    expect(view.getByRole('status', { name: 'Loading details…' })).toBeInTheDocument();
  },
};

/** While the text is still arriving, the start of it is shown with a note. */
export const DocumentPartial: Story = {
  parameters: { detailFixture: { stallAfter: 4 } },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('.detail-state__partial')).not.toBeNull(),
    );
    expect(canvasElement.textContent).toContain('Intro paragraph for the card.');
  },
};

/** When the text cannot be read, the tab says so and offers to try again. */
export const DocumentFailed: Story = {
  parameters: { detailFixture: { failDetail: true } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    expect(await view.findByRole('alert')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  },
};

/** A card with no text says so. */
export const DocumentEmpty: Story = {
  args: { task: makeTask({ id: 9, title: 'Nothing written yet', description: '', body: '' }) },
  play: async ({ canvasElement }) => {
    expect(await within(canvasElement).findByText('No description.')).toBeInTheDocument();
  },
};

/** The history tab reads the log only when it is opened; a failed read offers to try again. */
export const HistoryFailed: Story = {
  parameters: { detailFixture: { failDetail: true } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await userEvent.click(view.getByRole('tab', { name: /^History/ }));
    expect(await view.findByRole('alert')).toBeInTheDocument();
  },
};
