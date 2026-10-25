import type { Decorator } from '@storybook/react-vite';
import { useMemo, type ReactNode } from 'react';
import {
  createDetailFixtureAdapter,
  detailFixtureOf,
  type FixtureOptions,
} from '../../src/features/tasks/detail/detailFixture';
import type { Epic, Task } from '../../src/shared/api/contracts';
import { DataProvider } from '../../src/shared/data/react';

function DetailData({
  tasks,
  epics,
  options,
  children,
}: {
  tasks: readonly Task[];
  epics: readonly Epic[];
  options?: FixtureOptions;
  children: ReactNode;
}) {
  // A new adapter ends the connection, so the fixture is read once per story.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the arguments are fixed for a story
  const adapter = useMemo(
    () => createDetailFixtureAdapter(detailFixtureOf(tasks, epics), options),
    [],
  );
  return <DataProvider adapter={adapter}>{children}</DataProvider>;
}

/**
 * Serves the Detail of the story's `task`, `epic` and `epics` arguments, so a screen that reads its
 * Detail shows the text, conditions and history those arguments hold. A story can set the
 * `detailFixture` parameter to make the reads fail or stall (the loading, partial and failed states).
 */
export const detailData: Decorator = (Story, context) => {
  const { task, epic, epics } = context.args as {
    task?: Task | null;
    epic?: Epic;
    epics?: readonly Epic[];
  };
  return (
    <DetailData
      tasks={task && 'body' in task ? [task] : []}
      epics={[...(epics ?? []), ...(epic ? [epic] : [])]}
      options={context.parameters.detailFixture as FixtureOptions | undefined}
    >
      <Story />
    </DetailData>
  );
};
