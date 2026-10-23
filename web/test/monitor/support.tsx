import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { withMonitorFixtureData } from '../../src/pages/monitor/fixture-provider';
import { createMonitorFixture } from '../../src/pages/monitor/mock';

/** Renders a monitor screen with the data layer reading the sample project, as the app provides it. */
export function renderWithData(ui: ReactElement) {
  return render(withMonitorFixtureData(createMonitorFixture(), ui));
}
