import type { Meta, StoryObj } from '@storybook/react-vite';
import { LayersIcon, Trash2Icon } from 'lucide-react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeEpic } from '../../../../.storybook/support/fixtures';
import './detail.css';
import { DetailHeader } from './DetailHeader';
import { DraftBanner } from './DraftBanner';
import { EpicTabHeading } from './EpicTabHeading';
import { PreviewAction } from './PreviewAction';

const EPIC = makeEpic({
  id: 'PREVIEW-MODAL',
  name: 'Task and epic preview dialog',
  color: '#0a84ff',
});

const meta = {
  title: 'Task/Detail/PreviewEntry',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** E. The entrances: the toolbar's Preview button and the epic tab's heading with Open full screen. */
export const Entrances: Story = {
  render: () => {
    const onPreview = fn();
    const onOpen = fn();
    return (
      <div style={{ width: 332, padding: 16 }} data-testid="entry">
        <DetailHeader
          identity="#14"
          toolbar={
            <div className="detail__toolbar" role="toolbar">
              <PreviewAction onPreview={onPreview} />
              <button
                type="button"
                className="detail__tool detail__tool--delete"
                aria-label="Archive"
              >
                <Trash2Icon aria-hidden="true" />
              </button>
            </div>
          }
          onClose={() => {}}
        />
        <div style={{ height: 24 }} />
        <EpicTabHeading
          epic={EPIC}
          onOpen={onOpen}
          renderLabel={(epic) => (
            <span
              className="detail__epic-label"
              style={{ background: epic.color, color: '#fff' }}
              data-epic-label={epic.id}
            >
              <LayersIcon aria-hidden="true" />
              <span>{epic.id}</span>
            </span>
          )}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await userEvent.click(view.getByRole('button', { name: 'Preview' }));
    await userEvent.click(view.getByRole('button', { name: 'Open full screen' }));
    await expect(view.getByText('PREVIEW-MODAL')).toBeInTheDocument();
    await expect(view.getByRole('heading', { name: EPIC.name })).toBeInTheDocument();
  },
};

/** The draft banner of an epic, with its own texts. */
export const EpicDraftBanner: Story = {
  render: () => (
    <div style={{ width: 332, padding: 16 }}>
      <DraftBanner
        busy={false}
        failed={false}
        onFinalize={() => {}}
        description="Agents cannot change this epic. Once you finalize it, they can."
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByText(/Agents cannot change this epic/)).toBeInTheDocument();
    await expect(view.getByRole('button', { name: 'Finalize' })).toBeEnabled();
  },
};
