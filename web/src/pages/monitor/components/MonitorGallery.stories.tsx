import type { Meta, StoryObj } from '@storybook/react-vite';
import { MonitorView } from '../View';
import type { MonitorViewProps } from '../contracts';
import { createMonitorFixtureProps } from '../mock';
import { MonitorSectionHeader } from './MonitorSectionHeader';

type MonitorGalleryVariant =
  | 'loaded'
  | 'empty'
  | 'loading'
  | 'partial-fetch-failure'
  | 'section-headers';

function MonitorGallery({ variant = 'loaded' }: { variant?: MonitorGalleryVariant }) {
  const fixture = createMonitorFixtureProps();

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
  } else if (variant === 'partial-fetch-failure') {
    const sourceProject = fixture.projects[0];
    if (!sourceProject) return null;
    const unavailableProject = {
      ...sourceProject,
      id: 'b'.repeat(32),
      name: 'unavailable-project',
    };
    props = {
      ...fixture,
      projects: [...fixture.projects, unavailableProject],
      summary: null,
      freshness: {
        ...fixture.freshness,
        state: 'partial',
        failedProjectIds: [unavailableProject.id],
      },
    };
  }

  return <MonitorView {...props} />;
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

export const PartialFetchFailure: Story = {
  args: { variant: 'partial-fetch-failure' },
  globals: mobileJapaneseLight,
};

export const SectionHeaders: Story = {
  args: { variant: 'section-headers' },
  globals: mobileJapaneseLight,
};
