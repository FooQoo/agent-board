import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { MonitorTask } from '../../src/monitor/components/MonitorTask';
import type { MonitorTask as MonitorTaskModel } from '../../src/monitor/contracts';
import { PROJECT_A, makeTask } from '../fixtures';

beforeEach(() => selectLocale('en'));

function item(task = makeTask({ id: 4, title: 'Monitored' })): MonitorTaskModel {
  return { projectId: PROJECT_A.id, projectName: PROJECT_A.name, task };
}

describe('monitor task completion conditions', () => {
  it('shows the number of conditions done on the monitor task', () => {
    const task = makeTask({
      id: 4,
      title: 'Monitored',
      taskStatus: 'doing',
      acceptance: [
        { id: 'AC-1', text: 'one', done: true },
        { id: 'AC-2', text: 'two', done: false },
      ],
    });
    render(<MonitorTask item={item(task)} section="doing" />);
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('says that the conditions cannot be read', () => {
    const task = makeTask({ id: 4, title: 'Monitored', acceptanceError: true });
    render(<MonitorTask item={item(task)} section="done" />);
    expect(screen.getByText('Unreadable')).toBeTruthy();
  });
});
