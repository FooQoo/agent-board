import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { ImageLightbox } from './ImageLightbox';
import type { ViewerImage } from './ImageViewer';

/** A plain picture drawn as a data URI, so each slide is told apart without a file. */
const picture = (label: string, fill: string, height = 240): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${height}"><rect width="360" height="${height}" fill="${fill}"/><text x="180" y="${height / 2}" font-size="40" text-anchor="middle" fill="#0f172a" font-family="sans-serif">${label}</text></svg>`,
  )}`;

/** A tall picture: a gradient with a dark band at the top and a light band at the bottom. */
const TALL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="1600"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dbeafe"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><rect width="360" height="1600" fill="url(#g)"/><rect x="30" y="40" width="300" height="60" fill="#0f172a"/><rect x="30" y="1480" width="300" height="60" fill="#f8fafc"/></svg>',
)}`;

const THREE: ViewerImage[] = [
  { src: picture('One', '#dbeafe'), alt: 'First picture' },
  { src: picture('Two', '#dcfce7'), alt: 'Second picture' },
  { src: picture('Three', '#fef3c7'), alt: 'Third picture' },
];

const meta = {
  title: 'Shared/UI/ImageViewer',
  component: ImageLightbox,
  args: {
    images: THREE,
    startIndex: 0,
    label: (index: number) => THREE[index]?.alt ?? '',
    onClose: fn(),
  },
} satisfies Meta<typeof ImageLightbox>;

export default meta;
type Story = StoryObj<typeof meta>;

const openDialog = () =>
  waitFor(() => {
    const dialog = within(document.body).getByRole('dialog');
    expect(dialog).toBeVisible();
    return dialog;
  });

/** Several pictures: it opens at the chosen one, shows its position, and the arrow keys step. */
export const MultipleImages: Story = {
  args: { startIndex: 1 },
  play: async () => {
    const dialog = await openDialog();
    await expect(within(dialog).getByText('2 / 3')).toBeVisible();
    // There are no arrow buttons: the arrow keys (and a swipe) move between pictures.
    await expect(within(dialog).queryByRole('button', { name: /(Next|Previous)/ })).toBeNull();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(dialog).getByText('3 / 3')).toBeVisible());
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(within(dialog).getByText('2 / 3')).toBeVisible());
  },
};

/** The same pictures in Japanese on a phone-width window, in the dark theme. */
export const MultipleImagesDarkPhone: Story = {
  args: { startIndex: 0 },
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async () => {
    const dialog = await openDialog();
    await expect(within(dialog).getByText('1 / 3')).toBeVisible();
    await expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeVisible();
  },
};

const TALL_SET: ViewerImage[] = [
  { src: picture('Short', '#dbeafe'), alt: 'Short picture' },
  { src: TALL, alt: 'Tall picture' },
  { src: picture('Short', '#fef3c7'), alt: 'Another short picture' },
];

/**
 * On a phone-width window a tall picture fits the width and scrolls up and down inside its slide;
 * the frame stays within the screen, and the arrow keys still move to the next picture.
 */
export const TallImagePhone: Story = {
  args: {
    images: TALL_SET,
    startIndex: 1,
    label: (index: number) => TALL_SET[index]?.alt ?? '',
  },
  globals: { width: 'phone-375' },
  play: async () => {
    const dialog = await openDialog();
    await expect(within(dialog).getByText('2 / 3')).toBeVisible();
    await waitFor(() =>
      expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight),
    );
    const slide = within(dialog).getByRole('group', { name: '2 / 3' });
    await expect(slide.scrollHeight).toBeGreaterThan(slide.clientHeight);
    await expect(getComputedStyle(slide).overflowY).toBe('auto');
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(dialog).getByText('3 / 3')).toBeVisible());
  },
};

const ONE: ViewerImage[] = [{ src: TALL, alt: 'Tall picture' }];

/** One picture: no position and nothing to swipe to, and a tall picture still scrolls. */
export const SingleImage: Story = {
  args: { images: ONE, startIndex: 0, label: () => 'Tall picture' },
  globals: { width: 'phone-375' },
  play: async () => {
    const dialog = await openDialog();
    await expect(within(dialog).queryByText(/\d \/ \d/)).toBeNull();
    const slide = within(dialog).getByRole('group');
    await expect(slide.scrollHeight).toBeGreaterThan(slide.clientHeight);
  },
};

/**
 * On a phone the pinch that zooms the page stays with the browser: the viewer and its slide allow
 * it next to the sideways and vertical scrolling, so a picture can be zoomed in as well as swiped.
 */
export const PinchZoomPhone: Story = {
  args: { images: ONE, startIndex: 0, label: () => 'Tall picture' },
  globals: { width: 'phone-375' },
  play: async () => {
    const dialog = await openDialog();
    const viewer = dialog.querySelector('[data-viewer]') as HTMLElement;
    const slide = within(dialog).getByRole('group');
    for (const element of [viewer, slide]) {
      const action = getComputedStyle(element).touchAction;
      // The browser reports pan-x, pan-y and pinch-zoom together as `manipulation`.
      await expect(action).toMatch(/^(manipulation|.*pinch-zoom.*)$/);
    }
  },
};
