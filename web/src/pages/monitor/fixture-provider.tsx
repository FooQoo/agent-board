import { useMemo, type ReactElement, type ReactNode } from 'react';
import { DataProvider } from '../../shared/data/react';
import type { MonitorFixture } from './mock';
import { createMonitorFixtureAdapter, type FixtureAdapterOptions } from './mock-adapter';

function FixtureData({
  fixture,
  options,
  children,
}: {
  fixture: MonitorFixture;
  options?: FixtureAdapterOptions;
  children: ReactNode;
}) {
  // A new adapter ends the connection, so the options are read once per fixture.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `options` is fixed for a story
  const adapter = useMemo(() => createMonitorFixtureAdapter(fixture, options), [fixture]);
  return <DataProvider adapter={adapter}>{children}</DataProvider>;
}

/** Gives a story or a test the data layer, reading a fixture instead of a server. */
export function withMonitorFixtureData(
  fixture: MonitorFixture,
  children: ReactNode,
  options?: FixtureAdapterOptions,
): ReactElement {
  return (
    <FixtureData fixture={fixture} options={options}>
      {children}
    </FixtureData>
  );
}
