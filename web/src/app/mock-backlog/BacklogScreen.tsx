import { ListChecksIcon } from 'lucide-react';
import { type PointerEvent, useId, useMemo, useRef, useState } from 'react';
import type { DetailTab } from '../../features/tasks/detail/DetailTabs';
import { Button } from '@/shared/ui/button';
import { Drawer } from '@/shared/ui/drawer';
import { Header } from '../../shared/ui/app-header/Header';
import '../../pages/monitor/components/monitor-lanes.css';
import { buildFixture, countIn, type Fixture, type Lane, LANES, type MockCard } from './data';
import { DetailPane } from './DetailPane';
import {
  BoardLaneHeader,
  DragStack,
  LaneBody,
  type LaneActions,
  type Notice,
  NoticeBar,
} from './LaneParts';
import { DestinationSheet, type PhoneConfirm, SelectBar } from './PhoneParts';
import { SendSurface } from './SendSurface';
import { useIsJa, useMockText } from './text';
import './backlog-mock.css';

export interface Initial {
  /** Selection mode of the Backlog lane is on, with these cards selected. */
  selected?: number[];
  /** Shows the stack of the dragged cards over the Todo lane (PC) or the Todo tab (phone). */
  dragPreview?: boolean;
  /** The confirmation of the move is open for these cards. */
  confirm?: number[];
  /** The "choose where to move" sheet (phone alternative B) is open. */
  sheet?: boolean;
  /** The cards were just sent. */
  sentIds?: number[];
  openId?: number | null;
  tab?: DetailTab;
  lane?: Lane;
}

export interface BacklogScreenProps {
  variant?: 'desktop' | 'phone';
  /** Phone only: the way the move is confirmed. */
  phoneConfirm?: PhoneConfirm;
  initial?: Initial;
}

/**
 * The Backlog mock: a plain fourth lane. A button in the Backlog header (PC) or at the bottom of the lane
 * (phone) starts a selection mode like the bulk archive's; the selected cards then move to Todo together.
 * Data is fixed and held in memory; nothing is saved.
 */
export function BacklogScreen({
  variant = 'desktop',
  phoneConfirm = 'bar',
  initial = {},
}: BacklogScreenProps) {
  const ja = useIsJa();
  const m = useMockText();
  const fixture = useMemo<Fixture>(() => buildFixture(ja), [ja]);
  const [cards, setCards] = useState<MockCard[]>(() =>
    (initial.sentIds ?? []).reduce<MockCard[]>(
      (all, id) => all.map((c) => (c.id === id ? { ...c, lane: 'todo', sent: true } : c)),
      buildFixture(ja).cards,
    ),
  );
  const [selecting, setSelecting] = useState(initial.selected !== undefined);
  const [selected, setSelected] = useState<number[]>(initial.selected ?? []);
  const [confirm, setConfirm] = useState<number[] | null>(initial.confirm ?? null);
  const [sheet, setSheet] = useState(initial.sheet ?? false);
  const [openId, setOpenId] = useState<number | null>(initial.openId ?? null);
  const [tab, setTab] = useState<DetailTab>(initial.tab ?? 'description');
  const [lane, setLane] = useState<Lane>(initial.lane ?? 'backlog');
  const [dragging, setDragging] = useState(false);
  const [overTodo, setOverTodo] = useState(false);
  const [chipAt, setChipAt] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(() =>
    initial.sentIds
      ? {
          ids: initial.sentIds,
          b0: 5,
          b1: 5 - initial.sentIds.length,
          t0: 2,
          t1: 2 + initial.sentIds.length,
        }
      : null,
  );
  const lanesId = useId();
  const ghostRef = useRef<HTMLDivElement>(null);
  const kind = variant === 'phone' ? 'sheet' : 'dialog';
  const open = cards.find((card) => card.id === openId) ?? null;
  const preview = initial.dragPreview ?? false;

  const toggle = (id: number) =>
    setSelected((now) => (now.includes(id) ? now.filter((item) => item !== id) : [...now, id]));
  const leaveSelect = () => {
    setSelecting(false);
    setSelected([]);
  };

  const send = (ids: number[]) => {
    const b0 = countIn(cards, 'backlog');
    const t0 = countIn(cards, 'todo');
    setCards((all) =>
      all.map((c) =>
        ids.includes(c.id) ? { ...c, lane: 'todo', sent: true } : { ...c, sent: false },
      ),
    );
    setNotice({ ids, b0, b1: b0 - ids.length, t0, t1: t0 + ids.length });
    leaveSelect();
    setConfirm(null);
    setSheet(false);
    setLane('todo');
  };
  /** A card with an open question asks for a confirmation first; the rest go straight away. */
  const requestSend = (ids: number[]) => {
    if (ids.length === 0) return;
    setSheet(false);
    if (cards.some((c) => ids.includes(c.id) && c.question !== null)) setConfirm(ids);
    else send(ids);
  };
  const moveBack = (ids: number[]) => {
    setCards((all) =>
      all.map((c) => (ids.includes(c.id) ? { ...c, lane: 'backlog', sent: false } : c)),
    );
    setNotice(null);
    setLane('backlog');
  };

  const actions: LaneActions = {
    fixture,
    cards,
    selecting,
    selected,
    openId,
    dragging,
    onToggle: toggle,
    onOpenCard: (id) => {
      setOpenId(id);
      setTab('description');
    },
    onDragStart: (event) => {
      setDragging(true);
      event.dataTransfer.effectAllowed = 'move';
      if (ghostRef.current) event.dataTransfer.setDragImage(ghostRef.current, 28, 28);
    },
    onDragEnd: () => {
      setDragging(false);
      setOverTodo(false);
    },
  };

  const noticeView = notice && (
    <NoticeBar notice={notice} onUndo={moveBack} onDismiss={() => setNotice(null)} />
  );

  // Phone alternative C: the chip is held and dragged onto the Todo tab.
  const chipDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setChipAt({ x: event.clientX, y: event.clientY });
  };
  const chipMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!chipAt) return;
    setChipAt({ x: event.clientX, y: event.clientY });
    const under = document.elementFromPoint(event.clientX, event.clientY);
    setOverTodo(under?.closest('[data-lane="todo"][role="tab"]') != null);
  };
  const chipUp = () => {
    if (chipAt && overTodo) requestSend(selected);
    setChipAt(null);
    setOverTodo(false);
  };
  const tabHot = overTodo || (preview && phoneConfirm === 'tab');

  const detail = (statusLabels: 'pc' | 'monitor') =>
    open && (
      <DetailPane
        fixture={fixture}
        card={open}
        history={ja ? '履歴' : 'History'}
        tab={tab}
        onTab={setTab}
        onClose={() => setOpenId(null)}
        statusLabels={statusLabels}
        onToggleCondition={(conditionId, done) =>
          setCards((all) =>
            all.map((c) =>
              c.id === open.id
                ? {
                    ...c,
                    conditions: c.conditions.map((i) =>
                      i.id === conditionId ? { ...i, done } : i,
                    ),
                  }
                : c,
            ),
          )
        }
      />
    );

  const dropProps = {
    onDragOver: (event: React.DragEvent) => {
      if (!dragging) return;
      event.preventDefault();
      setOverTodo(true);
    },
    onDragLeave: () => setOverTodo(false),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setOverTodo(false);
      setDragging(false);
      requestSend(selected);
    },
  };

  return (
    <>
      {variant === 'desktop' ? (
        <div className="bapp">
          <Header canAdd onAdd={() => {}} />
          <main className="bboard">
            <div className="bboard__row">
              <div className="board__lanes bboard__lanes">
                {LANES.map((name) => (
                  <section
                    key={name}
                    className="lane blane"
                    data-column={name}
                    data-lane={name}
                    data-drop={
                      name === 'todo' && (overTodo || (preview && !dragging)) ? 'true' : undefined
                    }
                    aria-label={m[name]}
                    {...(name === 'todo' ? dropProps : {})}
                  >
                    <BoardLaneHeader
                      lane={name}
                      cards={cards}
                      selecting={selecting}
                      selectedCount={selected.length}
                      onToggleSelect={() => (selecting ? leaveSelect() : setSelecting(true))}
                    />
                    {name === 'backlog' && selecting && (
                      <p className="blane__hint">{m.selectHint}</p>
                    )}
                    <div className="lane__scroll">
                      <div className="lane__cards">
                        <LaneBody lane={name} a={actions} />
                      </div>
                    </div>
                    {name === 'todo' && (overTodo || preview) && (
                      <p className="blane__drop">{m.dropHere}</p>
                    )}
                  </section>
                ))}
              </div>
              {open && <div className="bboard__detail">{detail('pc')}</div>}
            </div>
          </main>
          {preview && <DragStack count={selected.length} floating />}
          <div className="bghost-offscreen" ref={ghostRef}>
            <DragStack count={selected.length} />
          </div>
        </div>
      ) : (
        <main className="monitor-shell bphone">
          <Header settingsSize="l" />
          <div className="lane-tabs btabs" role="tablist" aria-label="lanes">
            {LANES.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={lane === name}
                aria-controls={lanesId}
                className="lane-tabs__tab btabs__tab"
                data-lane={name}
                data-drop={name === 'todo' && tabHot ? 'true' : undefined}
                onClick={() => setLane(name)}
              >
                <span className="lane-tabs__name">{m[name]}</span>
                <strong className="lane-tabs__count">{countIn(cards, name)}</strong>
              </button>
            ))}
          </div>
          <div className="bphone__lane blane" id={lanesId} data-lane={lane}>
            <LaneBody lane={lane} a={actions} />
            {lane === 'backlog' && !selecting && countIn(cards, 'backlog') > 0 && (
              <Button
                type="button"
                variant="outline"
                className="bphone__enter"
                onClick={() => setSelecting(true)}
              >
                <ListChecksIcon aria-hidden="true" />
                {m.selectEnter}
              </Button>
            )}
          </div>
          {lane === 'backlog' && selecting && (
            <SelectBar
              mode={phoneConfirm}
              count={selected.length}
              onCancel={leaveSelect}
              onSend={() => requestSend(selected)}
              onSheet={() => setSheet(true)}
              chip={{ down: chipDown, move: chipMove, up: chipUp }}
            />
          )}
          {(chipAt || (preview && phoneConfirm === 'tab')) && (
            <div
              className="bchip-ghost"
              style={chipAt ? { left: chipAt.x, top: chipAt.y } : undefined}
              data-preview={chipAt ? undefined : 'true'}
            >
              <DragStack count={selected.length} />
            </div>
          )}
          <Drawer
            open={open !== null && confirm === null && !sheet}
            onOpenChange={(isOpen) => !isOpen && setOpenId(null)}
            identity={open ? `#${open.id}` : ''}
            title={open?.title ?? ''}
            className="bdrawer"
          >
            {detail('monitor')}
          </Drawer>
        </main>
      )}
      {noticeView}
      {sheet && (
        <DestinationSheet
          count={selected.length}
          onClose={() => setSheet(false)}
          onPick={() => requestSend(selected)}
        />
      )}
      {confirm && (
        <SendSurface
          kind={kind}
          cards={cards}
          ids={confirm}
          onClose={() => setConfirm(null)}
          onConfirm={() => send(confirm)}
        />
      )}
    </>
  );
}
