import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { MonitorCard } from '../../src/monitor/components/MonitorCard';
import type { MonitorCard as MonitorCardModel } from '../../src/monitor/contracts';
import { PROJECT_A, makeCard } from '../fixtures';

beforeEach(() => selectLocale('en'));

function item(card = makeCard({ id: 4, title: 'Monitored' })): MonitorCardModel {
  return { projectId: PROJECT_A.id, projectName: PROJECT_A.name, card };
}

describe('monitor card completion conditions', () => {
  it('shows the number of conditions done on the monitor card', () => {
    const card = makeCard({
      id: 4,
      title: 'Monitored',
      cardStatus: 'doing',
      acceptance: [
        { id: 'AC-1', text: 'one', done: true },
        { id: 'AC-2', text: 'two', done: false },
      ],
    });
    render(<MonitorCard item={item(card)} section="doing" />);
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('says that the conditions cannot be read', () => {
    const card = makeCard({ id: 4, title: 'Monitored', acceptanceError: true });
    render(<MonitorCard item={item(card)} section="done" />);
    expect(screen.getByText('Unreadable')).toBeTruthy();
  });
});
