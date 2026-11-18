import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { makeMonitorTask, makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import {
  SAMPLE_PROJECT,
  sampleMessages,
  sampleMessagesApi,
} from '../../../features/tasks/messages/messageSamples';
import { firstQuestionOfTask } from '../../../features/tasks/messages/model/messages';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import type { ColumnName } from '../../../shared/api/contracts';
import type { MonitorTask } from '../contracts';
import type { LaneItems } from './MonitorLanes';
import type { LanePending } from './MonitorLaneDialogs';
import { HOLD_MS } from '@/shared/lib/gesture/sideSwipe';
import { MonitorLanesScreen, type MonitorLanesScreenProps } from './MonitorLanesScreen';

const LANE_PROJECT_NAME = 'agent-board';

/** A synthetic card for the lane stories; a card with an open question waits for it. */
function card(
  project: ReturnType<typeof makeProject>,
  id: number,
  title: string,
  status: ColumnName,
  extra: Partial<Parameters<typeof makeTask>[0]> = {},
  questionIds: string[] = [],
): MonitorTask {
  return makeMonitorTask(
    {
      ...makeTask({ id, title, taskStatus: status, ...extra }),
      ...(questionIds.length > 0 ? { openQuestionIds: questionIds, questionIds } : {}),
    },
    project,
  );
}

/**
 * The sample board of the lane stories: a few cards in each lane, an AI run in progress, and a
 * card waiting for an answer, with the messages of the band.
 */
function useLaneFixture(options: { emptyDone?: boolean } = {}) {
  const { i18n } = useTranslation();
  const project = useMemo(() => makeProject({ id: SAMPLE_PROJECT, name: LANE_PROJECT_NAME }), []);
  // The first question waits on the card "API refactoring" (#11).
  const messages = useMemo(
    () =>
      sampleMessages(i18n.language).map((message) =>
        message.id === 'Q-12' ? { ...message, tasks: [11] } : message,
      ),
    [i18n.language],
  );
  const [lanes, setLanes] = useState<LaneItems>(() => {
    const waits = [firstQuestionOfTask(messages, 11)?.id ?? ''].filter(Boolean);
    return {
      todo: [
        card(project, 14, 'Prepare the Windows build', 'todo', { assignee: 'human' }),
        card(project, 15, 'Write the setup guide', 'todo'),
        card(project, 16, 'Refine the empty board', 'todo'),
        card(project, 17, 'Add a sample project to the first-run guide', 'todo', {
          assignee: 'human',
        }),
      ],
      doing: [
        card(
          project,
          11,
          'API refactoring',
          'doing',
          {
            agentStatus: 'pending',
            pendingReason: 'How much compatibility should v2 keep?',
            pendingRequestId: 'request-11',
          },
          waits,
        ),
        card(project, 12, 'Restore a board from JSON', 'doing', { agentStatus: 'running' }),
        card(project, 13, 'Check the board display on a narrow screen', 'doing', {
          assignee: 'human',
        }),
      ],
      done: options.emptyDone
        ? []
        : [
            card(project, 9, 'Return the card list as JSON', 'done'),
            card(project, 8, 'Initialize the board', 'done'),
            card(project, 7, 'Write the first-run guide', 'done', { assignee: 'human' }),
            card(project, 6, 'Show the version in the footer', 'done'),
          ],
    };
  });
  const messagesApi = useMemo(() => sampleMessagesApi(i18n.language), [i18n.language]);
  return { lanes, setLanes, messages, messagesApi, projectId: SAMPLE_PROJECT };
}

type ScreenArgs = Pick<MonitorLanesScreenProps, 'initialLane' | 'previewRevealed'> & {
  /** Opens a confirmation: `archive` and `move` use the card named by `pendingTask`. */
  pending?: 'archive' | 'move' | 'bulk';
  pendingTask?: number;
  emptyDone?: boolean;
};

/** The phone monitor's lane view over sample cards. Confirming a move or an archive changes them. */
function LanesStory({ pending, pendingTask, emptyDone, ...screen }: ScreenArgs) {
  const { lanes, setLanes, messages, messagesApi, projectId } = useLaneFixture({ emptyDone });
  const find = (id?: number) =>
    Object.values(lanes)
      .flat()
      .find((item) => item.task.id === id);
  const target = find(pendingTask);
  const initialPending: LanePending =
    pending === 'bulk'
      ? { kind: 'bulk' }
      : pending && target
        ? pending === 'archive'
          ? { kind: 'archive', item: target }
          : { kind: 'move', item: target, target: 'doing' }
        : null;
  const without = (id: number) => ({
    todo: lanes.todo.filter((item) => item.task.id !== id),
    doing: lanes.doing.filter((item) => item.task.id !== id),
    done: lanes.done.filter((item) => item.task.id !== id),
  });
  return (
    <MonitorLanesScreen
      {...screen}
      lanes={lanes}
      projectName={LANE_PROJECT_NAME}
      projectId={projectId}
      messages={messages}
      messagesApi={messagesApi}
      initialPending={initialPending}
      onMove={async (item: MonitorTask, to: ColumnName) => {
        const rest = without(item.task.id);
        setLanes({
          ...rest,
          [to]: [{ ...item, task: { ...item.task, taskStatus: to } }, ...rest[to]],
        });
      }}
      onArchive={async (item) => {
        setLanes(without(item.task.id));
        return true;
      }}
      onBulkArchive={async () => setLanes({ ...lanes, done: [] })}
    />
  );
}

// The mode is left to the toolbar (or the URL), so the same Story shows in light and in dark.
const phone = { locale: 'ja', width: 'phone-390' } as const;

const meta = {
  title: 'Pages/Monitor/Components/MonitorLanes',
  component: LanesStory,
  parameters: { storyFrame: 'monitor' },
  globals: phone,
} satisfies Meta<typeof LanesStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The time (ms) the synthetic events claim, one frame apart. The carousel judges a swipe by its
 * distance over its time, read from `event.timeStamp`. Events dispatched in a row would share a
 * stamp (or differ by whatever the machine's speed gives), the swipe would have no speed, and a
 * drag of under half the page would snap back; with a stamp of our own the speed is the same on
 * every machine.
 */
let clock = 0;
const FRAME_MS = 16;

/**
 * A pointer event on `target`, followed by the mouse event a browser sends with it. The card reads
 * pointer events (`@use-gesture/react`); the lane carousel reads mouse and touch events (Embla).
 */
function press(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
) {
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
  };
  const pointer = new PointerEvent(type, {
    ...init,
    pointerId: 7,
    pointerType: 'mouse',
    isPrimary: true,
  });
  const mouse = new MouseEvent(type.replace('pointer', 'mouse'), init);
  clock += FRAME_MS;
  for (const event of [pointer, mouse]) Object.defineProperty(event, 'timeStamp', { value: clock });
  target.dispatchEvent(pointer);
  target.dispatchEvent(mouse);
}
/** Holds a card still until it is chosen, then lets go: the card shows its focus ring. */
const choose = async (card: Element, x: number, y: number) => {
  press(card, 'pointerdown', x, y);
  await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 60));
  press(card, 'pointerup', x, y);
  await waitFor(() => expect(card).toHaveAttribute('data-armed'));
};
const cardOf = (canvas: HTMLElement, id: number) => {
  const found = canvas.querySelector(`[data-swipe-card="${id}"]`);
  if (!found) throw new Error(`No card ${id}.`);
  return found;
};
const tab = (canvas: HTMLElement, name: string) =>
  within(canvas).getByRole('tab', { name: new RegExp(name) });

/** 未着手 is the first lane: its tab is selected, and the other two lanes wait beside it. */
export const TodoLane: Story = {
  args: { initialLane: 'todo' },
  play: async ({ canvasElement }) => {
    await expect(tab(canvasElement, '未着手')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(canvasElement, '進行中')).toHaveAttribute('aria-selected', 'false');
    await expect(tab(canvasElement, '完了')).toHaveTextContent('4');
  },
};

/** A tap on a tab switches to that lane. */
export const TabSwitchesLane: Story = {
  args: { initialLane: 'todo' },
  play: async ({ canvasElement }) => {
    await userEvent.click(tab(canvasElement, '進行中'));
    await expect(tab(canvasElement, '進行中')).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tab(canvasElement, '完了'));
    await expect(
      within(canvasElement).getByRole('button', { name: 'まとめてアーカイブ' }),
    ).toBeVisible();
  },
};

/** 進行中 has an AI run in progress and a card that waits for an answer. */
export const DoingLane: Story = {
  args: { initialLane: 'doing' },
  play: async ({ canvasElement }) => {
    const waiting = cardOf(canvasElement, 11);
    await expect(waiting.querySelector('[data-agent-status="pending"]')).not.toBeNull();
    await expect(
      cardOf(canvasElement, 12).querySelector('[data-agent-status="running"]'),
    ).not.toBeNull();
    // The running loader turns on the lane card (unless the reader asks for reduced motion).
    const spinner = cardOf(canvasElement, 12).querySelector('.status-label--running .spinner');
    await expect(spinner).not.toBeNull();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await expect(getComputedStyle(spinner as Element).animationName).toBe(
      reduced ? 'none' : 'spin',
    );
  },
};

/**
 * A card slid to the left shows three tiles: the two other lanes and アーカイブ. Each tile is at
 * least 44px, and a lane tile opens the move question.
 */
export const ArchiveRevealed: Story = {
  args: { initialLane: 'todo', previewRevealed: 15 },
  play: async ({ canvasElement }) => {
    const card = within(cardOf(canvasElement, 15) as HTMLElement);
    const names = ['#15 を進行中へ移動', '#15 をアーカイブ'];
    await expect(card.queryByRole('button', { name: '#15 を完了へ移動' })).toBeNull();
    for (const name of names) {
      const tile = card.getByRole('button', { name });
      await expect(tile).toBeVisible();
      await expect(tile.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await userEvent.click(card.getByRole('button', { name: '#15 を進行中へ移動' }));
    const dialog = within(await within(document.body).findByRole('dialog'));
    await expect(dialog.getAllByText(/#15/).length).toBeGreaterThan(0);
  },
};

/** The archive button opens the archive question of the PC board. Nothing is archived yet. */
export const ArchiveConfirm: Story = {
  args: { initialLane: 'todo', previewRevealed: 15, pending: 'archive', pendingTask: 15 },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    await expect(dialog.getAllByText(/#15/).length).toBeGreaterThan(0);
    await expect(dialog.getByRole('button', { name: 'アーカイブ' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeEnabled();
  },
};

/** 完了 has まとめてアーカイブ below its cards, so the cards stay put whether or not it shows. */
export const DoneLane: Story = {
  args: { initialLane: 'done' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'まとめてアーカイブ' });
    await expect(button).toBeEnabled();
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    // Below the last card, so the cards keep their place.
    const cards = canvasElement.querySelectorAll('[data-lane="done"] [data-swipe-card]');
    await expect(button.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      (cards[cards.length - 1] as Element).getBoundingClientRect().bottom,
    );
  },
};

/** The bulk confirmation lists the completed cards, as the PC board does. */
export const BulkArchiveConfirm: Story = {
  args: { initialLane: 'done', pending: 'bulk' },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    await expect(dialog.getAllByRole('row')).toHaveLength(5);
    await expect(dialog.getByRole('button', { name: '4件をアーカイブ' })).toBeEnabled();
  },
};

/** With nothing completed the button is disabled and the lane says so. */
export const EmptyDoneLane: Story = {
  args: { initialLane: 'done', emptyDone: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'まとめてアーカイブ' }),
    ).toBeDisabled();
    await expect(within(canvasElement).getByText('完了した作業はありません。')).toBeVisible();
    const empty = within(canvasElement).getByText('完了した作業はありません。');
    await expect(
      within(canvasElement)
        .getByRole('button', { name: 'まとめてアーカイブ' })
        .getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(empty.getBoundingClientRect().bottom);
  },
};

/** Try it: tabs, a sideways swipe anywhere, a hold on a card and then a swipe on it. */
export const Interactive: Story = {
  args: { initialLane: 'todo' },
};

/** A held card is chosen; a left swipe on it then reveals its archive button, a swipe back closes it. */
export const SwipeRevealsArchive: Story = {
  args: { initialLane: 'todo' },
  play: async ({ canvasElement }) => {
    const card = cardOf(canvasElement, 15);
    const rect = card.getBoundingClientRect();
    const y = rect.top + 20;
    await choose(card, rect.right - 20, y);
    press(card, 'pointerdown', rect.right - 20, y);
    press(card, 'pointermove', rect.right - 60, y);
    press(card, 'pointermove', rect.right - 140, y);
    press(card, 'pointerup', rect.right - 140, y);
    await waitFor(() => expect(card).toHaveAttribute('data-revealed'));
    press(card, 'pointerdown', rect.right - 140, y);
    press(card, 'pointermove', rect.right - 100, y);
    press(card, 'pointermove', rect.right - 20, y);
    press(card, 'pointerup', rect.right - 20, y);
    await waitFor(() => expect(card).not.toHaveAttribute('data-revealed'));
  },
};

/** A right swipe on a chosen card in 進行中 shows the lane on its left, 未着手. */
export const RightSwipeShowsLeftLane: Story = {
  args: { initialLane: 'doing' },
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector<HTMLElement>(
      '.monitor-lane[data-lane="doing"] [data-swipe-card]',
    );
    if (!card) throw new Error('No doing card.');
    const id = card.dataset.swipeCard;
    const rect = card.getBoundingClientRect();
    const y = rect.top + 20;
    await choose(card, rect.left + 20, y);
    press(card, 'pointerdown', rect.left + 20, y);
    press(card, 'pointermove', rect.left + 60, y);
    press(card, 'pointermove', rect.left + 120, y);
    press(card, 'pointerup', rect.left + 120, y);
    await waitFor(() => expect(card).toHaveAttribute('data-revealed', 'left'));
    const tile = within(card).getByRole('button', { name: `#${id} を未着手へ移動` });
    await expect(tile).toBeVisible();
    await expect(within(card).queryByRole('button', { name: `#${id} をアーカイブ` })).toBeNull();
  },
};

/** A hold chooses the card, and the same press then swipes it open. */
export const HoldThenSwipeInOnePress: Story = {
  args: { initialLane: 'todo' },
  play: async ({ canvasElement }) => {
    const card = cardOf(canvasElement, 15);
    const rect = card.getBoundingClientRect();
    const y = rect.top + 20;
    press(card, 'pointerdown', rect.right - 20, y);
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 60));
    await waitFor(() => expect(card).toHaveAttribute('data-armed'));
    press(card, 'pointermove', rect.right - 60, y);
    press(card, 'pointermove', rect.right - 140, y);
    press(card, 'pointerup', rect.right - 140, y);
    await waitFor(() => expect(card).toHaveAttribute('data-revealed', 'right'));
    await expect(tab(canvasElement, '未着手')).toHaveAttribute('aria-selected', 'true');
  },
};

/** A sideways swipe on a card that is not chosen moves the lanes; the card does not slide. */
export const SwipeOnCardSwitchesLane: Story = {
  args: { initialLane: 'todo' },
  play: async ({ canvasElement }) => {
    const card = cardOf(canvasElement, 15);
    const rect = card.getBoundingClientRect();
    const y = rect.top + 20;
    press(card, 'pointerdown', rect.right - 20, y);
    for (const x of [rect.right - 50, rect.right - 160, rect.right - 260])
      press(card, 'pointermove', x, y);
    press(card, 'pointerup', rect.right - 260, y);
    await waitFor(() =>
      expect(tab(canvasElement, '進行中')).toHaveAttribute('aria-selected', 'true'),
    );
    await expect(card).not.toHaveAttribute('data-revealed');
    await expect(card).not.toHaveAttribute('data-armed');
  },
};

/** A sideways swipe on empty space moves to the next lane. */
export const SwipeSwitchesLane: Story = {
  args: { initialLane: 'todo' },
  play: async ({ canvasElement }) => {
    const lane = canvasElement.querySelector('.monitor-lane[data-lane="todo"]');
    if (!lane) throw new Error('No lane.');
    const rect = lane.getBoundingClientRect();
    const y = rect.top + 40;
    press(lane, 'pointerdown', rect.right - 30, y);
    press(lane, 'pointermove', rect.right - 120, y);
    press(lane, 'pointermove', rect.right - 220, y);
    press(lane, 'pointerup', rect.right - 220, y);
    await waitFor(() =>
      expect(tab(canvasElement, '進行中')).toHaveAttribute('aria-selected', 'true'),
    );
  },
};
