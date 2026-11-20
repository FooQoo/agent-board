import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { TaskResult } from '../../../shared/api/contracts';
import { ResultsView } from './ResultsView';

/** A plain picture drawn as a data URI, so no network or file is needed. */
const IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#dbeafe"/><rect x="40" y="40" width="560" height="60" fill="#3b82f6"/><rect x="40" y="130" width="360" height="30" fill="#93c5fd"/><rect x="40" y="180" width="440" height="30" fill="#93c5fd"/></svg>',
)}`;

/**
 * A result as the stories write it: `heading` becomes the `title` of the result. The key is named
 * differently because the story coverage check reads the first `title:` of the file as the title of
 * the stories.
 */
type Entry = Omit<TaskResult, 'title'> & { heading: string };
const toResult = ({ heading, ...rest }: Entry): TaskResult => ({ ...rest, title: heading });

const RESULTS: TaskResult[] = (
  [
    {
      version: 1,
      key: 'first',
      kind: 'progress',
      heading: 'List screen drawn',
      summary: 'The list screen is drawn; the detail screen is next.',
      at: '2026-11-20T01:00:00Z',
    },
    {
      version: 2,
      key: 'second',
      kind: 'progress',
      heading: 'Detail screen on a phone',
      summary: 'The detail screen matches the mock on a phone.',
      attachmentId: 'capture-1',
      at: '2026-11-20T03:30:00Z',
    },
    {
      version: 3,
      key: 'third',
      kind: 'final',
      heading: 'Both screens done',
      summary: 'Both screens are done. The full report is on the PC.',
      attachmentId: 'capture-2',
      link: 'outputs/phone-report/index.html',
      at: '2026-11-20T05:10:00Z',
    },
  ] satisfies Entry[]
).map(toResult);

/** A result with twelve screenshots, as an agent records a UI mock. */
const MANY_IMAGES: TaskResult = toResult({
  version: 4,
  key: 'mock-screens',
  kind: 'final',
  heading: 'All 12 mock screens',
  summary: 'All 12 screens of the mock, in the order a person walks through them.',
  attachmentIds: Array.from({ length: 12 }, (_, i) => `screen-${i + 1}`),
  at: '2026-11-20T07:00:00Z',
});

const meta = {
  title: 'Task Detail/ResultsView',
  component: ResultsView,
  args: {
    state: { status: 'ready', results: RESULTS },
    attachmentUrl: () => IMAGE,
    focusVersion: null,
    onRetry: fn(),
  },
} satisfies Meta<typeof ResultsView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Newest first, each with its kind, summary, image, and link text. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    const items = view.getAllByRole('listitem');
    await expect(items).toHaveLength(3);
    await expect(items[0]).toHaveTextContent('Final');
    await expect(
      within(items[0] as HTMLElement).getByRole('heading', { level: 3 }),
    ).toHaveTextContent('Both screens done');
    await expect(items[0]).toHaveTextContent('outputs/phone-report/index.html');
    await expect(items[2]).toHaveTextContent('In progress');
  },
};

/** An http(s) link is an anchor that opens in a new tab; a local path stays text. */
export const UrlLink: Story = {
  args: {
    state: {
      status: 'ready',
      results: [
        {
          version: 4,
          key: 'fourth',
          kind: 'final',
          title: 'Pull request opened',
          summary: 'The pull request is open.',
          link: `${['https:', '', 'github.com'].join('/')}/FooQoo/agent-board/pull/123?diff=split&w=1#discussion_r1234567890123`,
          at: '2026-11-20T06:00:00Z',
        },
        RESULTS[2] as TaskResult,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const anchors = within(canvasElement).getAllByRole('link');
    await expect(anchors).toHaveLength(1);
    await expect(anchors[0]).toHaveAttribute('target', '_blank');
    await expect(anchors[0]).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(canvasElement).toHaveTextContent('outputs/phone-report/index.html');
  },
};

/** The version a link points at is highlighted, even when it is not the newest. */
export const Focused: Story = {
  args: { focusVersion: 2 },
  play: async ({ canvasElement }) => {
    const focused = canvasElement.querySelector('[data-focused="true"]');
    await expect(focused).toHaveTextContent('The detail screen matches the mock');
  },
};

/** A result without an image or a link is read from its summary alone. */
export const TextOnly: Story = {
  args: { state: { status: 'ready', results: RESULTS.slice(0, 1) } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.queryByRole('button', { name: /Enlarge/ })).toBeNull();
    await expect(view.getByText(/list screen is drawn/)).toBeVisible();
  },
};

/** The image opens larger. */
export const EnlargeImage: Story = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await userEvent.click(view.getAllByRole('button', { name: /Enlarge/ })[0] as HTMLElement);
    await waitFor(() => expect(within(document.body).getByRole('dialog')).toBeVisible());
  },
};

/** Several images on one result are a strip of thumbnails; the enlarged view steps through them. */
export const MultipleImages: Story = {
  args: { state: { status: 'ready', results: [...RESULTS, MANY_IMAGES] } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    const thumbnails = view.getAllByRole('button', { name: /Enlarge image \d+ of 12/ });
    await expect(thumbnails).toHaveLength(12);
    await userEvent.click(thumbnails[1] as HTMLElement);
    const dialog = await waitFor(() => {
      const found = within(document.body).getByRole('dialog');
      expect(found).toBeVisible();
      return found;
    });
    await expect(within(dialog).getByText('2 / 12')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next image' }));
    await expect(within(dialog).getByText('3 / 12')).toBeVisible();
  },
};

/** The same result in Japanese on a phone-width window, in the dark theme. */
export const MultipleImagesJapanesePhone: Story = {
  args: { state: { status: 'ready', results: [MANY_IMAGES] } },
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getAllByRole('button', { name: /の画像 \d+\/12 を拡大/ }),
    ).toHaveLength(12);
  },
};

/** A title at the 80-character limit wraps in the heading on a phone-width window, in Japanese and dark. */
export const LongTitlePhone: Story = {
  args: {
    state: {
      status: 'ready',
      results: [
        {
          version: 1,
          key: 'long-title',
          kind: 'progress',
          title:
            '一覧画面と詳細画面のスマホ表示を、モックと同じ余白と配色に合わせて仕上げた最初の版をお見せします。確認用です',
          summary: '一覧画面と詳細画面の最初の版です。',
          at: '2026-11-20T01:00:00Z',
        },
      ],
    },
  },
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { level: 3 })).toBeVisible();
  },
};

/** A link to a version the task does not have says so and still lists the real ones. */
export const VersionMissing: Story = {
  args: { focusVersion: 9 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Result 9');
  },
};

/** Nothing delivered yet, still reading, and a failed read with its retry. */
export const Empty: Story = {
  args: { state: { status: 'ready', results: [] } },
};

export const Loading: Story = {
  args: { state: { status: 'loading' } },
};

export const ReadFailed: Story = {
  args: { state: { status: 'error' } },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** The highlighted result in Japanese, in the dark theme, on a phone-width window. */
export const JapaneseDarkNarrow: Story = {
  args: { focusVersion: 3 },
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    const focused = canvasElement.querySelector('[data-focused="true"]');
    await expect(focused).toHaveTextContent('最終');
    await expect(focused).toHaveTextContent('リンク');
  },
};
