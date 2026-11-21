import { SendIcon } from 'lucide-react';
import type { PointerEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { Surface } from './Surface';
import { useMockText } from './text';
import './backlog-mock.css';

export type PhoneConfirm = 'bar' | 'sheet' | 'tab';

interface ChipHandlers {
  down: (event: PointerEvent<HTMLButtonElement>) => void;
  move: (event: PointerEvent<HTMLButtonElement>) => void;
  up: () => void;
}

/** The bar at the bottom of the lane while cards are selected. Its action is the alternative being compared. */
export function SelectBar({
  mode,
  count,
  onCancel,
  onSend,
  onSheet,
  chip,
}: {
  mode: PhoneConfirm;
  count: number;
  onCancel: () => void;
  onSend: () => void;
  onSheet: () => void;
  chip: ChipHandlers;
}) {
  const m = useMockText();
  return (
    <div className="bbar" role="region" aria-label={m.selectedCount(count)}>
      <span className="bbar__count">{m.selectedCount(count)}</span>
      <div className="bbar__actions">
        <Button type="button" size="s" variant="outline" onClick={onCancel}>
          {m.barCancel}
        </Button>
        {mode === 'bar' && (
          <Button type="button" size="s" disabled={count === 0} onClick={onSend}>
            <SendIcon aria-hidden="true" />
            {m.barSend(count)}
          </Button>
        )}
        {mode === 'sheet' && (
          <Button type="button" size="s" disabled={count === 0} onClick={onSheet}>
            {m.sheetTitle}
          </Button>
        )}
        {mode === 'tab' && (
          <button
            type="button"
            className="bchip"
            disabled={count === 0}
            onPointerDown={chip.down}
            onPointerMove={chip.move}
            onPointerUp={chip.up}
          >
            {m.tabDragChip(count)}
          </button>
        )}
      </div>
      {mode === 'tab' && <p className="bbar__hint">{m.tabDragHint}</p>}
    </div>
  );
}

/** Alternative B: a sheet that asks for the destination lane. Only Todo can be reached from Backlog. */
export function DestinationSheet({
  count,
  onClose,
  onPick,
}: {
  count: number;
  onClose: () => void;
  onPick: () => void;
}) {
  const m = useMockText();
  return (
    <Surface
      kind="sheet"
      title={m.sheetTitle}
      identity={m.sheetNote(count)}
      onClose={onClose}
      className="bdest"
    >
      <ul className="bdest__list">
        <li>
          <Button type="button" className="bdest__item" onClick={onPick}>
            {m.todo}
          </Button>
        </li>
        {(['doing', 'done'] as const).map((name) => (
          <li key={name}>
            <Button type="button" variant="outline" className="bdest__item" disabled>
              {m[name]}
            </Button>
          </li>
        ))}
      </ul>
      <p className="bdest__note">{m.sheetOnlyTodo}</p>
    </Surface>
  );
}
