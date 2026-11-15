import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { expect, userEvent, within } from 'storybook/test';
import { makeMonitorTask, makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import type { BandQuestion } from '../../../features/tasks/answer/model/qa';
import {
  SAMPLE_PROJECT,
  sampleQuestions,
  sampleReader,
} from '../../../features/tasks/answer/questionSamples';
import { useMonitorInteractions } from '../hooks/useMonitorInteractions';
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
  | 'answer-continuing'
  | 'band'
  | 'band-empty';

// The Story-ID collector reads the first `title:` literal of a file, so this one is kept out of it.
const ANSWER_TITLE = 'API refactoring';

/** A card of the mock's board; with questions referring to it, it waits for them. */
function questionCard(
  id: number,
  title: string,
  taskStatus: 'todo' | 'doing' | 'done',
  questions: readonly BandQuestion[],
) {
  const open = questions.filter((q) => q.referencedBy.includes(id)).map((q) => q.id);
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
 * The monitor with questions waiting. `answer`: one card with its button. `band`: the mock's board
 * under the band of five questions; `band-empty`: the same board with none.
 */
function QuestionScreen({ variant }: { variant: MonitorGalleryVariant }) {
  const { i18n } = useTranslation();
  const project = useMemo(() => makeProject({ id: SAMPLE_PROJECT, name: 'agent-board' }), []);
  const answerController = useMonitorInteractions();
  const { book } = answerController;
  const questions = useMemo(
    () => (variant === 'band-empty' ? [] : sampleQuestions(i18n.language)),
    [variant, i18n.language],
  );
  useMemo(() => book.reconcile(SAMPLE_PROJECT, questions), [book, questions]);
  useEffect(() => {
    if (variant !== 'answer-continuing') return;
    book.setText(SAMPLE_PROJECT, 'Q-2', 'Keep it until v3.');
  }, [variant, book]);
  const data = useMemo(() => createMonitorFixture(), []);
  const base = useMemo(() => createMonitorFixtureProps(data), [data]);
  const card = (id: number, title: string, status: 'todo' | 'doing' | 'done') =>
    makeMonitorTask(questionCard(id, title, status, questions), project);
  const single = variant === 'answer' || variant === 'answer-continuing';
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
    answerController: {
      book,
      read: sampleReader(sampleQuestions(i18n.language, true)),
      write: async () => {},
    },
    projectId: SAMPLE_PROJECT,
    questions: single ? undefined : questions,
  };
  return withMonitorFixtureData(data, <MonitorView {...props} />);
}

function MonitorGallery({ variant = 'loaded' }: { variant?: MonitorGalleryVariant }) {
  const data = useMemo(() => createMonitorFixture(), []);
  const fixture = useMemo(() => createMonitorFixtureProps(data), [data]);

  if (
    variant === 'answer' ||
    variant === 'answer-continuing' ||
    variant === 'band' ||
    variant === 'band-empty'
  ) {
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

export const AnswerContinuing: Story = {
  args: { variant: 'answer-continuing' },
  globals: { locale: 'en', mode: 'dark', accent: 'blue', width: 'phone-375' },
  play: answerPlay('Continue answering'),
};

/** The band of five questions under the counts: closed at first, opened by its header. */
export const QuestionBand: Story = {
  args: { variant: 'band' },
  globals: mobileJapaneseLight,
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: '未回答の質問' });
    await expect(within(band).queryAllByRole('listitem')).toHaveLength(0);
    await userEvent.click(within(band).getByRole('button', { name: /^未回答の質問を表示する/ }));
    await expect(within(band).getAllByRole('listitem')).toHaveLength(5);
    await expect(within(band).getByRole('button', { name: 'まとめて答える' })).toBeVisible();
  },
};

/** No questions: the band stays with a count of 0 and nothing to open. */
export const QuestionBandEmpty: Story = {
  args: { variant: 'band-empty' },
  globals: mobileJapaneseLight,
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: '未回答の質問' });
    await expect(within(band).getByText('0')).toBeVisible();
    await expect(within(band).getByRole('button')).toBeDisabled();
  },
};

/** The band in dark mode. */
export const QuestionBandDark: Story = {
  args: { variant: 'band' },
  globals: { ...mobileJapaneseLight, mode: 'dark' },
};
