import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo } from 'react';
import { expect, within } from 'storybook/test';
import { makeMonitorTask, makeProject, makeTask } from '../../../../.storybook/support/fixtures';
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
  | 'answer-continuing';

// The Story-ID collector reads the first `title:` literal of a file, so this one is kept out of it.
const ANSWER_TITLE = 'API refactoring';
const answerTask = makeTask({
  id: 11,
  title: ANSWER_TITLE,
  taskStatus: 'doing',
  agentStatus: 'pending',
  pendingReason: 'How much compatibility should v2 keep?',
  pendingRequestId: 'request-11',
  pendingChoices: [
    { id: 'keep', label: 'Keep compatibility' },
    { id: 'break', label: 'Allow the breaking change' },
  ],
});

/** One decision card with the monitor's answer button; with `continuing` an answer is already started. */
function AnswerCard({ continuing }: { continuing: boolean }) {
  const project = useMemo(() => makeProject(), []);
  const answerController = useMonitorInteractions();
  const { stateStore } = answerController;
  useEffect(() => {
    if (!continuing) return;
    const key = `${project.id}:${answerTask.id}:request-11` as const;
    stateStore.getSnapshot(key);
    stateStore.update(key, (state) => ({ ...state, text: 'Keep it until v3.' }));
  }, [continuing, project.id, stateStore]);
  const data = useMemo(() => createMonitorFixture(), []);
  const base = useMemo(() => createMonitorFixtureProps(data), [data]);
  const props: MonitorViewProps = {
    ...base,
    summary: { todo: 0, doing: 1, done: 0 },
    todo: [],
    doing: [makeMonitorTask(answerTask, project)],
    done: [],
    answerController,
  };
  return withMonitorFixtureData(data, <MonitorView {...props} />);
}

function MonitorGallery({ variant = 'loaded' }: { variant?: MonitorGalleryVariant }) {
  const data = useMemo(() => createMonitorFixture(), []);
  const fixture = useMemo(() => createMonitorFixtureProps(data), [data]);

  if (variant === 'answer' || variant === 'answer-continuing') {
    return <AnswerCard continuing={variant === 'answer-continuing'} />;
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
