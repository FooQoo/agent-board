import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../shared/i18n';
import { withMonitorFixtureData } from './fixture-provider';
import { createMonitorFixture, createMonitorFixtureProps } from './mock';
import { MonitorView } from './View';

function renderPhoneBoard() {
  const fixture = createMonitorFixture();
  const props = createMonitorFixtureProps(fixture);
  return render(withMonitorFixtureData(fixture, <MonitorView {...props} />));
}

describe('MonitorView initial lane', () => {
  it('opens on the Doing lane', () => {
    renderPhoneBoard();
    const tabs = screen.getAllByRole('tab');
    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toMatch(/Doing/);
  });
});
