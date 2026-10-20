import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AcceptanceEditor } from '../../src/features/tasks/acceptance/AcceptanceEditor';
import { selectLocale } from '../../src/shared/i18n';
import type { AcceptanceItem } from '../../src/shared/api/contracts';

beforeEach(() => selectLocale('en'));

const item = (id: string, done = false, text = `text ${id}`): AcceptanceItem => ({
  id,
  text,
  done,
});

/** The editor with its own state, so a test can see what it was asked to hold. */
function Harness({
  initial,
  onState,
}: {
  initial: AcceptanceItem[];
  onState: (items: AcceptanceItem[]) => void;
}) {
  const [items, setItems] = useState(initial);
  return (
    <AcceptanceEditor
      items={items}
      onChange={(next) => {
        setItems(next);
        onState(next);
      }}
    />
  );
}

function setup(initial: AcceptanceItem[] = []) {
  let latest: AcceptanceItem[] = initial;
  render(<Harness initial={initial} onState={(items) => (latest = items)} />);
  return () => latest;
}

describe('AcceptanceEditor', () => {
  it('adds a condition with the next number and focuses its text', () => {
    const latest = setup([item('AC-1')]);
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(latest().map((i) => i.id)).toEqual(['AC-1', 'AC-2']);
    expect(document.activeElement).toBe(screen.getByLabelText('Condition AC-2'));
  });

  it('does not reuse the number of a removed condition', () => {
    const latest = setup([item('AC-1'), item('AC-2')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove AC-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(latest().map((i) => i.id)).toEqual(['AC-1', 'AC-3']);
  });

  it('changes the text and the done flag, and keeps the ID', () => {
    const latest = setup([item('AC-1')]);
    fireEvent.change(screen.getByLabelText('Condition AC-1'), { target: { value: 'New text' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(latest()).toEqual([{ id: 'AC-1', text: 'New text', done: true }]);
  });

  it('has no way to reorder conditions: the order and the IDs stay as they are', () => {
    const latest = setup([item('AC-1'), item('AC-2'), item('AC-3')]);
    expect(screen.queryByRole('button', { name: /Move AC-\d+ (up|down)/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Condition AC-2'), { target: { value: 'Changed' } });
    expect(latest().map((i) => i.id)).toEqual(['AC-1', 'AC-2', 'AC-3']);
  });

  it('marks an empty text as invalid', () => {
    setup([item('AC-1', false, '')]);
    expect(screen.getByLabelText('Condition AC-1').getAttribute('aria-invalid')).toBe('true');
  });
});
