import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
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
  | 'section-headers';

function MonitorGallery({ variant = 'loaded' }: { variant?: MonitorGalleryVariant }) {
  const data = useMemo(() => createMonitorFixture(), []);
  const fixture = useMemo(() => createMonitorFixtureProps(data), [data]);

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
