import { CheckCircle2Icon, ListChecksIcon, XIcon } from 'lucide-react';
import type { DragEvent } from 'react';
import { EpicLabel } from '../../features/epics/label/EpicLabel';
import { TaskCardView } from '../../features/tasks/card/TaskCard';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { countIn, type Fixture, type Lane, type MockCard, summaryOf } from './data';
import { useMockText } from './text';
import './backlog-mock.css';

export type Notice = {
  ids: number[];
  b0: number;
  b1: number;
  t0: number;
  t1: number;
};

export interface LaneActions {
  fixture: Fixture;
  cards: MockCard[];
  /** Selection mode of the Backlog lane (modelled on the bulk archive). */
  selecting: boolean;
  selected: number[];
  openId: number | null;
  /** The PC drag of the selected cards is in progress. */
  dragging: boolean;
  onToggle: (id: number) => void;
  onOpenCard: (id: number) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

/** The stack shown while the selected cards are dragged: the top card and a count badge. */
export function DragStack({ count, floating = false }: { count: number; floating?: boolean }) {
  const m = useMockText();
  return (
    <div className="bghost" data-floating={floating || undefined} aria-hidden="true">
      <span className="bghost__card bghost__card--back" />
      <span className="bghost__card bghost__card--mid" />
      <span className="bghost__card bghost__card--top">{m.backlog}</span>
      <span className="bghost__count">{m.dragCount(count)}</span>
    </div>
  );
}

function CardRow({ card, a }: { card: MockCard; a: LaneActions }) {
  const m = useMockText();
  const inSelect = a.selecting && card.lane === 'backlog';
  const isSelected = a.selected.includes(card.id);
  const canDrag = inSelect && isSelected;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the drag handle of a selected card; the keyboard path is the send button
    <div
      className="brow"
      data-lane={card.lane}
      data-selected={isSelected || undefined}
      data-sent={card.sent ? 'true' : undefined}
      data-dragging={a.dragging && isSelected ? 'true' : undefined}
      draggable={canDrag}
      onDragStart={canDrag ? a.onDragStart : undefined}
      onDragEnd={canDrag ? a.onDragEnd : undefined}
    >
      {inSelect && (
        <Checkbox
          className="brow__radio"
          checked={isSelected}
          aria-label={m.selectCard(card.id)}
          onCheckedChange={() => a.onToggle(card.id)}
        />
      )}
      <div className="brow__card">
        <TaskCardView
          task={summaryOf(card, a.fixture.epics)}
          selected={a.openId === card.id}
          onSelect={() => (inSelect ? a.onToggle(card.id) : a.onOpenCard(card.id))}
          renderEpic={(epic) => (
            <EpicLabel epic={epic} className="card__epic" onClick={() => undefined} />
          )}
        >
          {(card.question && card.lane === 'backlog') || card.sent ? (
            <span className="bmarks">
              {card.question && card.lane === 'backlog' && (
                <Badge variant="pending">{m.openQuestion}</Badge>
              )}
              {card.sent && <span className="bmark bmark--sent">{m.sentMark}</span>}
            </span>
          ) : null}
        </TaskCardView>
      </div>
    </div>
  );
}

export function LaneBody({ lane, a }: { lane: Lane; a: LaneActions }) {
  const m = useMockText();
  const own = a.cards.filter((card) => card.lane === lane);
  if (own.length === 0) return <p className="blane__empty">{m.laneEmpty}</p>;
  return own.map((card) => <CardRow key={card.id} card={card} a={a} />);
}

/**
 * A lane header in the board's own classes. The Backlog header carries the selection button, the way the
 * Done header carries the bulk-archive button (`lane-header__archive`).
 */
export function BoardLaneHeader({
  lane,
  cards,
  selecting,
  selectedCount,
  onToggleSelect,
}: {
  lane: Lane;
  cards: readonly MockCard[];
  selecting: boolean;
  selectedCount: number;
  onToggleSelect: () => void;
}) {
  const m = useMockText();
  const count = countIn(cards, lane);
  return (
    <header className="lane-header">
      <h2 className="lane-header__name">{m[lane]}</h2>
      <span className="lane-header__count">{count}</span>
      {lane === 'backlog' && (
        <>
          {selecting && <span className="blane__picked">{m.selectedCount(selectedCount)}</span>}
          <button
            type="button"
            className="lane-header__archive blane__select-btn"
            aria-label={selecting ? m.selectExit : m.selectEnter}
            title={selecting ? m.selectExit : m.selectEnter}
            aria-pressed={selecting}
            onClick={onToggleSelect}
            disabled={count === 0}
          >
            {selecting ? <XIcon aria-hidden="true" /> : <ListChecksIcon aria-hidden="true" />}
          </button>
        </>
      )}
    </header>
  );
}

/** The toast after a send: what moved and the way back. The moved cards stand out in Todo. */
export function NoticeBar({
  notice,
  onUndo,
  onDismiss,
}: {
  notice: Notice;
  onUndo: (ids: number[]) => void;
  onDismiss: () => void;
}) {
  const m = useMockText();
  return (
    <div className="bnotice" role="status">
      <CheckCircle2Icon aria-hidden="true" />
      <div className="bnotice__text">
        <strong>
          {m.resultSent(notice.ids.length)} ({notice.ids.map((id) => `#${id}`).join(', ')})
        </strong>
        <span>{m.resultCounts(notice.b0, notice.b1, notice.t0, notice.t1)}</span>
      </div>
      <Button type="button" size="s" variant="outline" onClick={() => onUndo(notice.ids)}>
        {m.resultUndo}
      </Button>
      <Button type="button" size="s" variant="outline" onClick={onDismiss}>
        {m.dismiss}
      </Button>
    </div>
  );
}
