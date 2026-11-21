import { CheckCircle2Icon, ClockIcon, SendIcon } from 'lucide-react';
import { EpicLabel } from '../../features/epics/label/EpicLabel';
import { TaskCardView } from '../../features/tasks/card/TaskCard';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { allAchieved, type Fixture, type Lane, type MockCard, summaryOf } from './data';
import { useMockText } from './text';
import './backlog-mock.css';

export type Notice = {
  kind: 'sent';
  ids: number[];
  b0: number;
  b1: number;
  t0: number;
  t1: number;
};

export interface LaneActions {
  fixture: Fixture;
  cards: MockCard[];
  selected: number[];
  openId: number | null;
  onToggle: (id: number) => void;
  onOpenCard: (id: number) => void;
  onSendEpic: (epicId: string) => void;
  onSendSelected: (epicId: string) => void;
  onSendOne: (id: number) => void;
  onClearSelection: () => void;
}

/** The marks under a card: plan, open question, all conditions achieved, just sent, edited. */
function Marks({ card }: { card: MockCard }) {
  const m = useMockText();
  const backlog = card.lane === 'backlog';
  return (
    <span className="bmarks">
      {backlog && (
        <span className="bmark bmark--plan">
          <ClockIcon aria-hidden="true" />
          {m.notStartedMark}
        </span>
      )}
      {card.question && backlog && <Badge variant="pending">{m.openQuestion}</Badge>}
      {backlog && allAchieved(card) && (
        <span className="bmark bmark--done">
          <CheckCircle2Icon aria-hidden="true" />
          {m.allAchieved}
        </span>
      )}
      {card.sent && <span className="bmark bmark--sent">{m.sentMark}</span>}
    </span>
  );
}

function CardRow({ card, a }: { card: MockCard; a: LaneActions }) {
  const m = useMockText();
  return (
    <div className="brow" data-lane={card.lane} data-sent={card.sent ? 'true' : undefined}>
      {card.lane === 'backlog' && (
        <Checkbox
          className="brow__check"
          checked={a.selected.includes(card.id)}
          aria-label={m.selectCard(card.id)}
          onCheckedChange={() => a.onToggle(card.id)}
        />
      )}
      <div className="brow__card">
        <TaskCardView
          task={summaryOf(card, a.fixture.epics)}
          selected={a.openId === card.id}
          onSelect={() => a.onOpenCard(card.id)}
          renderEpic={(epic) => (
            <EpicLabel epic={epic} className="card__epic" onClick={() => undefined} />
          )}
        >
          <Marks card={card} />
        </TaskCardView>
      </div>
    </div>
  );
}

/** Backlog groups its cards by epic, so the epic can be read and sent as a whole. */
function BacklogGroups({ a }: { a: LaneActions }) {
  const m = useMockText();
  const groups = [...new Set(a.cards.filter((c) => c.lane === 'backlog').map((c) => c.epicId))];
  if (groups.length === 0) return <p className="blane__empty">{m.laneEmpty}</p>;
  return groups.map((epicId) => {
    const own = a.cards.filter((c) => c.lane === 'backlog' && c.epicId === epicId);
    const epic = a.fixture.epics.find((item) => item.id === epicId);
    const pickedHere = a.selected.filter((id) => own.some((c) => c.id === id));
    return (
      <section key={epicId ?? 'none'} className="bgroup" aria-label={epic?.id ?? m.standalone}>
        <header className="bgroup__head">
          {epic ? (
            <>
              <EpicLabel epic={epic} className="card__epic" onClick={() => undefined} />
              <span className="bgroup__name">{epic.name}</span>
            </>
          ) : (
            <span className="bgroup__name">{m.standalone}</span>
          )}
        </header>
        <div className="bgroup__actions">
          {epic ? (
            <Button
              type="button"
              size="s"
              className="bgroup__wide"
              onClick={() => a.onSendEpic(epic.id)}
            >
              <SendIcon aria-hidden="true" />
              {m.sendEpic(own.length)}
            </Button>
          ) : (
            <Button type="button" size="s" onClick={() => a.onSendOne(own[0]?.id ?? 0)}>
              <SendIcon aria-hidden="true" />
              {m.sendCard}
            </Button>
          )}
        </div>
        {epic && pickedHere.length > 0 && (
          <div className="bgroup__picked" role="status">
            <span>{m.selectedCount(pickedHere.length)}</span>
            <Button type="button" size="s" onClick={() => a.onSendSelected(epic.id)}>
              <SendIcon aria-hidden="true" />
              {m.sendSelected(pickedHere.length)}
            </Button>
            <Button type="button" size="s" variant="outline" onClick={a.onClearSelection}>
              {m.clearSelection}
            </Button>
          </div>
        )}
        {own.map((card) => (
          <CardRow key={card.id} card={card} a={a} />
        ))}
      </section>
    );
  });
}

export function LaneBody({ lane, a }: { lane: Lane; a: LaneActions }) {
  const m = useMockText();
  if (lane === 'backlog') return <BacklogGroups a={a} />;
  const own = a.cards.filter((card) => card.lane === lane);
  if (own.length === 0) return <p className="blane__empty">{m.laneEmpty}</p>;
  return own.map((card) => <CardRow key={card.id} card={card} a={a} />);
}

/** The result of a send or a save, with the way back for a send. */
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
    <div className="bnotice" role="status" data-kind={notice.kind}>
      <CheckCircle2Icon aria-hidden="true" />
      <div className="bnotice__text">
        <strong>
          {m.resultSent(notice.ids.length)} ({notice.ids.map((id) => `#${id}`).join(', ')})
        </strong>
        <span>{m.resultCounts(notice.b0, notice.b1, notice.t0, notice.t1)}</span>
      </div>
      {
        <Button type="button" size="s" variant="outline" onClick={() => onUndo(notice.ids)}>
          {m.resultUndo}
        </Button>
      }
      <Button type="button" size="s" variant="outline" onClick={onDismiss}>
        {m.dismiss}
      </Button>
    </div>
  );
}
