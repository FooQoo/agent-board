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
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { ColumnName } from '../../../shared/api/contracts';
import type { ArchivedTask } from '../../../features/tasks/api/read';
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

/** An archived card as the archive reads it: no body, history or attachments. */
function archivedCard(
  id: number,
  title: string,
  status: ColumnName,
  archivedAt: string,
  assignee: 'ai' | 'human' = 'ai',
): ArchivedTask {
  const { description, body, history, attachments, acceptance, ...rest } = makeTask({
    id,
    title,
    taskStatus: status,
    assignee,
  });
  return { ...rest, acceptance: { done: acceptance.length, total: acceptance.length }, archivedAt };
}

/**
 * The sample board of the lane stories: a few cards in each lane, an AI run in progress, and a
 * card waiting for an answer, with the messages of the band.
 */
function useLaneFixture(
  options: { emptyDone?: boolean; emptyArchive?: boolean; manyArchived?: number } = {},
) {
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
  // Archived as they were: each keeps the lane it was archived from.
  const [archived, setArchived] = useState<ArchivedTask[]>(() =>
    options.emptyArchive
      ? []
      : options.manyArchived
        ? Array.from({ length: options.manyArchived }, (_, index) =>
            archivedCard(
              1000 + index,
              `Archived task ${index + 1}`,
              index % 2 === 0 ? 'done' : 'todo',
              '2026-10-01T09:00:00.000Z',
            ),
          )
        : [
            archivedCard(5, 'Write the release notes', 'done', '2026-10-01T09:00:00.000Z'),
            archivedCard(4, 'Try the demo on a phone', 'done', '2026-09-30T09:00:00.000Z', 'human'),
            archivedCard(3, 'Draft the onboarding tour', 'todo', '2026-09-28T09:00:00.000Z'),
          ],
  );
  return {
    lanes,
    setLanes,
    archived,
    setArchived,
    messages,
    messagesApi,
    projectId: SAMPLE_PROJECT,
  };
}

type ScreenArgs = Pick<
  MonitorLanesScreenProps,
  | 'initialLane'
  | 'previewRevealed'
  | 'previewBulkDrag'
  | 'previewPull'
  | 'onRefresh'
  | 'refreshing'
  | 'onAsk'
> & {
  /** Opens a confirmation: `archive` uses the card named by `pendingTask`. */
  pending?: 'archive' | 'bulk' | 'list' | 'list-revealed';
  pendingTask?: number;
  emptyDone?: boolean;
  emptyArchive?: boolean;
  /** Archives this many tasks, to show that only a window of rows is drawn. */
  manyArchived?: number;
};

/** The phone monitor's lane view over sample cards. A move changes them at once; an archive changes them once confirmed. */
function LanesStory({
  pending,
  pendingTask,
  emptyDone,
  emptyArchive,
  manyArchived,
  ...screen
}: ScreenArgs) {
  const { lanes, setLanes, archived, setArchived, messages, messagesApi, projectId } =
    useLaneFixture({ emptyDone, emptyArchive, manyArchived });
  const find = (id?: number) =>
    Object.values(lanes)
      .flat()
      .find((item) => item.task.id === id);
  const target = find(pendingTask);
  const initialPending: LanePending =
    pending === 'bulk'
      ? { kind: 'bulk' }
      : pending === 'list'
        ? { kind: 'list' }
        : pending === 'list-revealed'
          ? { kind: 'list', revealed: 5 }
          : pending && target
            ? { kind: 'archive', item: target }
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
      archive={{
        data: {
          project: makeProject({ id: SAMPLE_PROJECT, name: LANE_PROJECT_NAME }),
          version: 'v1',
          tasks: archived,
          epics: [],
          total: archived.length,
        },
        status: 'ready',
      }}
      onRestore={async (id) => {
        const task = archived.find((entry) => entry.id === id);
        if (!task) return;
        setArchived(archived.filter((entry) => entry.id !== id));
        // The task returns to the lane it was archived from.
        const item = makeMonitorTask(
          makeTask({ id, title: task.title, taskStatus: task.taskStatus, assignee: task.assignee }),
          makeProject({ id: SAMPLE_PROJECT, name: LANE_PROJECT_NAME }),
        );
        setLanes({ ...lanes, [task.taskStatus]: [...lanes[task.taskStatus], item] });
      }}
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
 * least 44px, and a lane tile moves the card at once, with no question.
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
    const count = (name: string) =>
      Number(/\d+/.exec(tab(canvasElement, name).textContent ?? '')?.[0]);
    const doing = count('進行中');
    await userEvent.click(card.getByRole('button', { name: '#15 を進行中へ移動' }));
    // No dialog opens: the card moves at once, and the lane counts follow.
    await expect(within(document.body).queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(count('進行中')).toBe(doing + 1));
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

/** まとめてアーカイブ sits after the last card of the lane, not in the bar. */
export const DoneLane: Story = {
  args: { initialLane: 'done' },
  play: async ({ canvasElement }) => {
    const lane = within(
      canvasElement.querySelector('.monitor-lane[data-lane="done"]') as HTMLElement,
    );
    await expect(lane.getByRole('button', { name: 'まとめてアーカイブ' })).toBeEnabled();
    const bar = within(canvasElement).getByRole('navigation', { name: '主なナビゲーション' });
    await expect(within(bar).queryByRole('button', { name: 'まとめてアーカイブ' })).toBeNull();
  },
};

/** The bulk confirmation lists the completed cards in a bottom sheet. */
export const BulkArchiveConfirm: Story = {
  args: { initialLane: 'done', pending: 'bulk' },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    await expect(dialog.getAllByRole('row')).toHaveLength(5);
    await expect(dialog.getByRole('button', { name: '4件をアーカイブ' })).toBeEnabled();
  },
};

/** The Archive all tile the Done lane uncovers while it follows the finger. */
function bulkTile(section: Element) {
  const tile = section.querySelector('[data-bulk-tile]');
  if (!tile) throw new Error('No Archive all tile.');
  return tile;
}

/**
 * The Done lane dragged to the left follows the finger and shows the Archive all tile, in the
 * look of a card's archive tile. The tile is a picture only: it takes no press and is hidden from
 * assistive technology, which have the button after the cards.
 */
export const BulkArchiveDragging: Story = {
  args: { initialLane: 'done', previewBulkDrag: 64 },
  play: async ({ canvasElement }) => {
    const section = canvasElement.querySelector('.monitor-lane[data-lane="done"]') as HTMLElement;
    const tile = bulkTile(section);
    await expect(tile).toHaveAttribute('data-revealed');
    await expect(tile).toHaveAttribute('aria-hidden', 'true');
    await expect(tile.getBoundingClientRect().width).toBe(64);
    await expect(within(document.body).queryByRole('dialog')).toBeNull();
    await expect(
      within(section).getAllByRole('button', { name: 'まとめてアーカイブ' }),
    ).toHaveLength(1);
  },
};

/**
 * On the Done lane, a long swipe to the left makes the lane follow the finger and show the Archive
 * all tile; lifting the finger springs it back and opens the bulk-archive confirmation as a drawer.
 */
export const BulkArchiveBySwipe: Story = {
  args: { initialLane: 'done' },
  play: async ({ canvasElement }) => {
    const section = canvasElement.querySelector('.monitor-lane[data-lane="done"]');
    const lane = section?.querySelector('.monitor-lane__scroll');
    if (!section || !lane) throw new Error('No Done lane.');
    const rect = lane.getBoundingClientRect();
    const y = rect.bottom - 24;
    press(lane, 'pointerdown', rect.right - 40, y);
    press(lane, 'pointermove', rect.right - 90, y);
    press(lane, 'pointermove', rect.right - 160, y);
    await waitFor(() => expect(bulkTile(section)).toHaveAttribute('data-revealed'));
    press(lane, 'pointerup', rect.right - 160, y);
    const sheet = await within(document.body).findByRole('dialog');
    await expect(sheet.getAttribute('data-slot')).toBe('drawer-popup');
    await expect(within(sheet).getAllByRole('row')).toHaveLength(5);
    await waitFor(() => expect(bulkTile(section)).not.toHaveAttribute('data-revealed'));
  },
};

/** A short drag on the Done lane springs back and asks nothing. */
export const BulkArchiveShortSwipe: Story = {
  args: { initialLane: 'done' },
  play: async ({ canvasElement }) => {
    const section = canvasElement.querySelector('.monitor-lane[data-lane="done"]');
    const lane = section?.querySelector('.monitor-lane__scroll');
    if (!section || !lane) throw new Error('No Done lane.');
    const rect = lane.getBoundingClientRect();
    const y = rect.bottom - 24;
    press(lane, 'pointerdown', rect.right - 40, y);
    press(lane, 'pointermove', rect.right - 70, y);
    press(lane, 'pointerup', rect.right - 70, y);
    await waitFor(() => expect(bulkTile(section)).not.toHaveAttribute('data-revealed'));
    await expect(within(document.body).queryByRole('dialog')).toBeNull();
  },
};

/** The button after the last Done card asks the same, for a keyboard or a screen reader. */
export const BulkArchiveButton: Story = {
  args: { initialLane: 'done' },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'まとめてアーカイブ' }),
    );
    const sheet = await within(document.body).findByRole('dialog');
    await expect(within(sheet).getAllByRole('row')).toHaveLength(5);
  },
};

/** The bar's アーカイブ item opens the list of archived tasks as a drawer. */
export const ArchiveFromBar: Story = {
  args: { initialLane: 'done' },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('navigation', { name: '主なナビゲーション' });
    await userEvent.click(within(bar).getByRole('button', { name: 'アーカイブ済みタスク' }));
    const sheet = await within(document.body).findByRole('dialog');
    await expect(sheet.getAttribute('data-slot')).toBe('drawer-popup');
    await expect(within(sheet).getAllByRole('listitem')).toHaveLength(3);
    // Switching tabs closes it.
    await userEvent.click(within(bar).getByRole('button', { name: 'ボード', hidden: true }));
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
  },
};

/** With nothing archived the list says so. */
export const ArchiveListEmpty: Story = {
  args: { initialLane: 'todo', pending: 'list', emptyArchive: true },
  play: async () => {
    const sheet = await within(document.body).findByRole('dialog');
    await expect(within(sheet).getByText('アーカイブされたタスクはありません')).toBeVisible();
  },
};

/** With 300 archived tasks only a window of rows is in the DOM, and scrolling brings in the rest. */
export const ArchiveListMany: Story = {
  args: { initialLane: 'todo', pending: 'list', manyArchived: 300 },
  play: async () => {
    const sheet = await within(document.body).findByRole('dialog');
    const rows = () => sheet.querySelectorAll('[data-archive-row]');
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    await expect(rows().length).toBeLessThan(40);
    await expect(sheet.querySelector('[data-archive-row="1299"]')).toBeNull();
    const body = sheet.querySelector<HTMLElement>('.surface__body');
    if (!body) throw new Error('No sheet body.');
    body.scrollTop = body.scrollHeight;
    await waitFor(() => expect(sheet.querySelector('[data-archive-row="1299"]')).not.toBeNull());
    await expect(sheet.querySelector('[data-archive-row="1000"]')).toBeNull();
    await expect(rows().length).toBeLessThan(40);
  },
};

/** With only the keyboard: focus a card, press Enter to open 復元 and move focus to it, press it. */
export const RestoreByKeyboard: Story = {
  args: { initialLane: 'todo', pending: 'list' },
  play: async ({ canvasElement }) => {
    const sheet = await within(document.body).findByRole('dialog');
    const card = sheet.querySelector<HTMLElement>('[data-archive-row="3"] .swipe-card');
    if (!card) throw new Error('No card in row 3.');
    card.focus();
    await userEvent.keyboard('{Enter}');
    const restore = within(sheet).getByRole('button', { name: '#3 を復元' });
    await waitFor(() => expect(restore).toHaveFocus());
    // The right arrow closes the tile and gives focus back to the card.
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(card).toHaveFocus());
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(restore).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sheet.querySelector('[data-archive-row="3"]')).toBeNull());
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.monitor-lane[data-lane="todo"] [data-swipe-card="3"]'),
      ).not.toBeNull(),
    );
  },
};

/** A row swiped left: the 復元 tile is open on its right. */
export const ArchiveRowRevealed: Story = {
  args: { initialLane: 'todo', pending: 'list-revealed' },
  play: async () => {
    const sheet = await within(document.body).findByRole('dialog');
    const row = sheet.querySelector('[data-archive-row="5"] .swipe-card');
    await expect(row).toHaveAttribute('data-revealed');
    await expect(within(sheet).getByRole('button', { name: '#5 を復元' })).toBeVisible();
  },
};

/** Swipe a row left, press 復元: the task leaves the list and returns to the lane it came from. */
export const RestoreBySwipe: Story = {
  args: { initialLane: 'todo', pending: 'list' },
  play: async ({ canvasElement }) => {
    const sheet = await within(document.body).findByRole('dialog');
    const row = sheet.querySelector('[data-archive-row="3"]');
    if (!row) throw new Error('No row 3.');
    const card = row.querySelector('.swipe-card');
    if (!card) throw new Error('No card in row 3.');
    const rect = card.getBoundingClientRect();
    const y = rect.top + 20;
    press(card, 'pointerdown', rect.right - 20, y);
    press(card, 'pointermove', rect.right - 60, y);
    press(card, 'pointermove', rect.right - 140, y);
    press(card, 'pointerup', rect.right - 140, y);
    await waitFor(() => expect(card).toHaveAttribute('data-revealed'));
    await userEvent.click(within(sheet).getByRole('button', { name: '#3 を復元' }));
    await waitFor(() => expect(sheet.querySelector('[data-archive-row="3"]')).toBeNull());
    await expect(within(sheet).getAllByRole('listitem')).toHaveLength(2);
    // The card was archived from 未着手, so it is back there.
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.monitor-lane[data-lane="todo"] [data-swipe-card="3"]'),
      ).not.toBeNull(),
    );
  },
};

/** With nothing completed the lane says so, and offers no bulk archive. */
export const EmptyDoneLane: Story = {
  args: { initialLane: 'done', emptyDone: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: 'まとめてアーカイブ' }),
    ).toBeNull();
    await expect(within(canvasElement).getByText('完了した作業はありません。')).toBeVisible();
  },
};

/** Five items in the bar, Ask in the middle; the count on メッセージ is the open questions. */
export const BottomBar: Story = {
  args: { initialLane: 'todo' },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('navigation', { name: '主なナビゲーション' });
    const items = within(bar).getAllByRole('button');
    await expect(items.map((item) => item.textContent?.replace(/^\d+/, ''))).toEqual([
      'ボード',
      'メッセージ',
      '依頼',
      'アーカイブ',
      '設定',
    ]);
    await expect(items[2]).toHaveAccessibleName('AI に依頼');
    await expect(within(bar).getByRole('button', { name: 'メッセージ 2' })).toBeVisible();
    // Clear of the home indicator: the bar ends inside the window.
    await expect(bar.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  },
};

/** メッセージ opens the list of questions and requests, with no 依頼 entry inside. */
export const MessagesFromBar: Story = {
  args: { initialLane: 'todo' },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('navigation', { name: '主なナビゲーション' });
    await userEvent.click(within(bar).getByRole('button', { name: 'メッセージ 2' }));
    const sheet = within(await within(document.body).findByRole('dialog', { name: 'メッセージ' }));
    await expect(sheet.getAllByRole('tab')).toHaveLength(2);
    await expect(sheet.queryByRole('button', { name: /依頼する|AI に依頼/ })).toBeNull();
  },
};

/** 依頼 reaches the screen's callback, which opens the request form. */
export const AskFromBar: Story = {
  args: { initialLane: 'todo', onAsk: fn() },
  play: async ({ canvasElement, args }) => {
    const bar = within(canvasElement).getByRole('navigation', { name: '主なナビゲーション' });
    await userEvent.click(within(bar).getByRole('button', { name: 'AI に依頼' }));
    await expect(args.onAsk).toHaveBeenCalledOnce();
  },
};

/** 設定 opens the settings as a bottom sheet. */
export const SettingsFromBar: Story = {
  args: { initialLane: 'todo' },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('navigation', { name: '主なナビゲーション' });
    await userEvent.click(within(bar).getByRole('button', { name: '設定' }));
    const sheet = await within(document.body).findByRole('dialog', { name: '設定' });
    await expect(sheet.getAttribute('data-slot')).toBe('drawer-popup');
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

/** A finger on `target`, as a touch event. The lanes watch touch events for the pull. */
function touch(
  type: 'touchstart' | 'touchmove' | 'touchend',
  target: Element,
  x: number,
  y: number,
) {
  const point = new Touch({ identifier: 1, target, clientX: x, clientY: y });
  target.dispatchEvent(
    new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: type === 'touchend' ? [] : [point],
      changedTouches: [point],
    }),
  );
}

const scrollerOfLane = (canvasElement: HTMLElement, lane: string) =>
  canvasElement.querySelector(`[data-lane="${lane}"] .monitor-lane__scroll`) as HTMLElement;

/** Pulling the lane down from its top: the cards follow the finger and the hint reads "ひっぱって更新". */
export const PullToRefresh: Story = {
  args: { initialLane: 'todo', previewPull: 'pulling' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('ひっぱって更新')).toBeVisible();
  },
};

/** Pulled far enough: the arrow turns over and a release will refresh. */
export const PullReady: Story = {
  args: { initialLane: 'todo', previewPull: 'ready' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('指をはなして更新')).toBeVisible();
  },
};

/** Refreshing: a spinner above the cards. */
export const Refreshing: Story = {
  args: { initialLane: 'todo', previewPull: 'refreshing' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('更新中…')).toBeInTheDocument();
  },
};

/** A long pull from the top of the lane refreshes on release; a short one does not. */
export const PullGesture: Story = {
  args: { initialLane: 'todo', onRefresh: fn() },
  play: async ({ canvasElement, args }) => {
    const list = scrollerOfLane(canvasElement, 'todo');
    const card = list.querySelector('[data-swipe-card]') as HTMLElement;
    const y = card.getBoundingClientRect().top + 20;
    touch('touchstart', card, 100, y);
    touch('touchmove', card, 100, y + 30);
    touch('touchmove', card, 100, y + 50);
    touch('touchend', card, 100, y + 50);
    await expect(args.onRefresh).not.toHaveBeenCalled();
    touch('touchstart', card, 100, y);
    touch('touchmove', card, 100, y + 40);
    touch('touchmove', card, 100, y + 120);
    await expect(await within(canvasElement).findByText('指をはなして更新')).toBeVisible();
    touch('touchend', card, 100, y + 120);
    await expect(args.onRefresh).toHaveBeenCalledOnce();
  },
};

/** A sideways drag is left to the lane carousel and never pulls. */
export const SidewaysIsNotAPull: Story = {
  args: { initialLane: 'todo', onRefresh: fn() },
  play: async ({ canvasElement, args }) => {
    const card = scrollerOfLane(canvasElement, 'todo').querySelector(
      '[data-swipe-card]',
    ) as HTMLElement;
    const y = card.getBoundingClientRect().top + 20;
    touch('touchstart', card, 200, y);
    touch('touchmove', card, 120, y + 10);
    touch('touchmove', card, 40, y + 60);
    touch('touchend', card, 40, y + 60);
    await expect(args.onRefresh).not.toHaveBeenCalled();
    await expect(canvasElement.querySelector('.monitor-pull')).toBeNull();
  },
};
