import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { expect, within } from 'storybook/test';
import { makeMonitorTask, makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import type { Message } from '../../../shared/data/api/contracts';
import {
  SAMPLE_PROJECT,
  sampleMessages,
  sampleMessagesApi,
} from '../../../features/tasks/messages/messageSamples';
import { MonitorView } from '../View';
import type { MonitorViewProps } from '../contracts';
import { withMonitorFixtureData } from '../fixture-provider';
import { createMonitorFixture, createMonitorFixtureProps } from '../mock';
import { MonitorSectionHeader } from './MonitorSectionHeader';

type MonitorGalleryVariant =
  | 'loaded'
  | 'empty'
  | 'loading'
  | 'data-problems'
  | 'refreshing'
  | 'stale'
  | 'section-headers'
  | 'answer'
  | 'band'
  | 'band-empty';

// The Story-ID collector reads the first `title:` literal of a file, so this one is kept out of it.
const ANSWER_TITLE = 'API refactoring';

/** A card of the mock's board; with an open question referring to it, it waits for it. */
function questionCard(
  id: number,
  title: string,
  taskStatus: 'todo' | 'doing' | 'done',
  messages: readonly Message[],
) {
  const open = messages
    .filter((m) => m.type === 'question' && m.tasks.includes(id))
    .map((m) => m.id);
  return {
    ...makeTask({
      id,
      title,
      taskStatus,
      agentStatus: open.length > 0 ? 'pending' : 'idle',
      pendingReason: open.length > 0 ? 'How much compatibility should v2 keep?' : null,
      pendingRequestId: open.length > 0 ? `request-${id}` : null,
    }),
    openQuestionIds: open,
    questionIds: open,
  };
}

/**
 * The monitor with messages waiting. `answer`: one card with its button. `band`: the mock's board
 * under the band of messages; `band-empty`: the same board with none.
 */
function QuestionScreen({ variant }: { variant: MonitorGalleryVariant }) {
  const { i18n } = useTranslation();
  const project = useMemo(() => makeProject({ id: SAMPLE_PROJECT, name: 'agent-board' }), []);
  // The first question waits on the card "API refactoring" (#11).
  const messages = useMemo(
    () =>
      variant === 'band-empty'
        ? []
        : sampleMessages(i18n.language).map((message) =>
            message.id === 'Q-12' ? { ...message, tasks: [11] } : message,
          ),
    [variant, i18n.language],
  );
  const messagesApi = useMemo(() => sampleMessagesApi(i18n.language), [i18n.language]);
  const data = useMemo(() => createMonitorFixture(), []);
  const base = useMemo(() => createMonitorFixtureProps(data), [data]);
  const card = (id: number, title: string, status: 'todo' | 'doing' | 'done') =>
    makeMonitorTask(questionCard(id, title, status, messages), project);
  const single = variant === 'answer';
  const lists = single
    ? { todo: [], doing: [card(11, ANSWER_TITLE, 'doing')], done: [] }
    : {
        todo: [
          card(14, 'Prepare the Windows build', 'todo'),
          card(15, 'Write the setup guide', 'todo'),
          card(16, 'Refine the empty board', 'todo'),
        ],
        doing: [
          card(11, ANSWER_TITLE, 'doing'),
          card(12, 'Restore a board from JSON', 'doing'),
          card(13, 'Check the board display', 'doing'),
        ],
        done: [
          card(9, 'Return the card list as JSON', 'done'),
          card(8, 'Initialize the board', 'done'),
        ],
      };
  const props: MonitorViewProps = {
    ...base,
    ...lists,
    summary: { todo: lists.todo.length, doing: lists.doing.length, done: lists.done.length },
    projectId: SAMPLE_PROJECT,
    messages: single ? undefined : messages,
    messagesApi,
    // The card's button opens the list, so the single-card variant needs the messages too.
    ...(single ? { messages } : {}),
    onAsk: () => {},
  };
  return withMonitorFixtureData(data, <MonitorView {...props} />);
}

function MonitorGallery({ variant = 'loaded' }: { variant?: MonitorGalleryVariant }) {
  const data = useMemo(() => createMonitorFixture(), []);
  const fixture = useMemo(() => createMonitorFixtureProps(data), [data]);

  if (variant === 'answer' || variant === 'band' || variant === 'band-empty') {
    return <QuestionScreen variant={variant} />;
  }

  if (variant === 'section-headers') {
    return (
      <div className="monitor-list">
        <MonitorSectionHeader section="todo" count={fixture.todo.length} />
        <MonitorSectionHeader section="doing" count={fixture.doing.length} />
        <MonitorSectionHeader section="done" count={fixture.done.length} />
      </div>
    );
  }

  let props: MonitorViewProps = fixture;
  if (variant === 'empty') {
    props = { ...fixture, summary: { todo: 0, doing: 0, done: 0 }, todo: [], doing: [], done: [] };
  } else if (variant === 'loading') {
    props = {
      ...fixture,
      summary: null,
      todo: [],
      doing: [],
      done: [],
      freshness: { ...fixture.freshness, state: 'loading', lastFetchedAt: null },
    };
  } else if (variant === 'data-problems') {
    props = {
      ...fixture,
      summary: null,
      freshness: {
        ...fixture.freshness,
        state: 'partial',
        snapshotProblems: [
          {
            projectId: data.projectId,
            file: 'projects/x/tasks/2/task.json',
            field: 'body',
            reason: 'bad',
          },
        ],
      },
    };
  } else if (variant === 'refreshing') {
    props = { ...fixture, refreshing: true, freshness: { ...fixture.freshness, state: 'syncing' } };
  } else if (variant === 'stale') {
    props = { ...fixture, freshness: { ...fixture.freshness, state: 'stale' } };
  }

  return withMonitorFixtureData(data, <MonitorView {...props} />);
}

const meta = {
  title: 'Pages/Monitor/Components/MonitorGallery',
  component: MonitorGallery,
  parameters: { storyFrame: 'monitor' },
} satisfies Meta<typeof MonitorGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

const mobileJapaneseLight = {
  locale: 'ja',
  mode: 'light',
  accent: 'blue',
  width: 'phone-375',
} as const;

export const Empty: Story = {
  args: { variant: 'empty' },
  globals: mobileJapaneseLight,
};

export const Loading: Story = {
  args: { variant: 'loading' },
  globals: mobileJapaneseLight,
};

export const DataProblems: Story = {
  args: { variant: 'data-problems' },
  globals: mobileJapaneseLight,
};

/** A refresh the person asked for is running, so the button waits. */
export const Refreshing: Story = {
  args: { variant: 'refreshing' },
  globals: { locale: 'en', mode: 'dark', accent: 'blue', width: 'phone-375' },
};

/** The notifications stopped: the list is marked as not current and can be refreshed by hand. */
export const Stale: Story = {
  args: { variant: 'stale' },
  globals: { locale: 'en', mode: 'dark', accent: 'blue', width: 'phone-320' },
};

export const SectionHeaders: Story = {
  args: { variant: 'section-headers' },
  globals: mobileJapaneseLight,
};

/** Under a decision request the card shows one button, below the meta row and a divider. */
const answerPlay =
  (name: string) =>
  async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const card = await within(canvasElement).findByRole('article', { name: /API refactoring/ });
    const button = within(card).getByRole('button', { name });
    await expect(button.getBoundingClientRect().height).toBe(34);
    const meta = card.querySelector('.monitor-card__meta');
    const request = card.querySelector('.monitor-card__request');
    if (!meta || !request) throw new Error('The card has no meta row or request area.');
    await expect(
      meta.compareDocumentPosition(request) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expect(getComputedStyle(request).borderTopWidth).toBe('1px');
    await expect(within(card).queryByText('How much compatibility should v2 keep?')).toBeNull();
  };

export const Answer: Story = {
  args: { variant: 'answer' },
  globals: mobileJapaneseLight,
  play: answerPlay('質問に回答する'),
};

/** The bottom bar: Board, Messages with the count of open questions, Ask in the middle, Archive and Settings. */
export const BottomBar: Story = {
  args: { variant: 'band' },
  globals: mobileJapaneseLight,
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('navigation', { name: '主なナビゲーション' });
    await expect(within(bar).getAllByRole('button')).toHaveLength(5);
    await expect(within(bar).getByRole('button', { name: 'メッセージ 2' })).toBeVisible();
    await expect(within(bar).getByRole('button', { name: 'AI に依頼' })).toBeVisible();
    // The band that the bar replaced is gone.
    await expect(within(canvasElement).queryByRole('region', { name: 'メッセージ' })).toBeNull();
  },
};

/** Nothing is open: Messages shows no count. */
export const BottomBarNoQuestions: Story = {
  args: { variant: 'band-empty' },
  globals: mobileJapaneseLight,
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('navigation', { name: '主なナビゲーション' });
    const messages = within(bar).getByRole('button', { name: 'メッセージ' });
    await expect(messages).toBeVisible();
    await expect(messages.querySelector('.phone-nav__badge')).toBeNull();
  },
};

/** The dock takes the selected theme color: yellow, a light accent that needs dark text on its badge. */
export const BottomBarYellow: Story = {
  args: { variant: 'band' },
  globals: { ...mobileJapaneseLight, accent: 'yellow' },
};

/** The dock in dark mode. */
export const BottomBarDark: Story = {
  args: { variant: 'band' },
  globals: { ...mobileJapaneseLight, mode: 'dark' },
};
