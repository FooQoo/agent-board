import { useId, useMemo, useState } from 'react';
import type { DetailTab } from '../../features/tasks/detail/DetailTabs';
import { Drawer } from '@/shared/ui/drawer';
import { Header } from '../../shared/ui/app-header/Header';
import type { AcceptanceItem } from '../../shared/api/contracts';
import { buildFixture, countIn, type Fixture, type Lane, LANES, type MockCard } from './data';
import { DetailPane } from './DetailPane';
import { EditSurface } from './EditSurface';
import { EpicPlan } from './EpicPlan';
import { LaneBody, type LaneActions, type Notice, NoticeBar } from './LaneParts';
import { SendSurface, type SendTarget } from './SendSurface';
import { useIsJa, useMockText } from './text';
import '../../pages/monitor/components/monitor-lanes.css';
import './backlog-mock.css';

export type Overlay =
  | { kind: 'none' }
  | { kind: 'plan'; epicId: string }
  | { kind: 'edit'; id: number }
  | { kind: 'send'; target: SendTarget };

export interface Initial {
  overlay?: Overlay;
  selected?: number[];
  /** The card whose detail is open. */
  openId?: number | null;
  tab?: DetailTab;
  /** Shows the result of a send, as if it had just run. */
  sentIds?: number[];
  /** Starts on this lane (phone). */
  lane?: Lane;
}

export interface BacklogScreenProps {
  variant?: 'desktop' | 'phone';
  initial?: Initial;
}

const patch = (cards: MockCard[], id: number, change: Partial<MockCard>) =>
  cards.map((card) => (card.id === id ? { ...card, ...change } : card));

/**
 * The Backlog mock: the board (or the phone monitor) with a Backlog lane before Todo, the card detail,
 * the whole-epic plan, the plan editor and the "Send to Todo" confirmation. Data is fixed and held in
 * memory; nothing is saved.
 */
export function BacklogScreen({ variant = 'desktop', initial = {} }: BacklogScreenProps) {
  const ja = useIsJa();
  const m = useMockText();
  const fixture = useMemo<Fixture>(() => buildFixture(ja), [ja]);
  const [cards, setCards] = useState<MockCard[]>(() => {
    const base = buildFixture(ja).cards;
    // A story can start right after a send.
    return (initial.sentIds ?? []).reduce(
      (all, id) => patch(all, id, { lane: 'todo', sent: true }),
      base,
    );
  });
  const [selected, setSelected] = useState<number[]>(initial.selected ?? []);
  const [overlay, setOverlay] = useState<Overlay>(initial.overlay ?? { kind: 'none' });
  const [openId, setOpenId] = useState<number | null>(initial.openId ?? null);
  const [tab, setTab] = useState<DetailTab>(initial.tab ?? 'description');
  const [lane, setLane] = useState<Lane>(initial.lane ?? 'backlog');
  const [notice, setNotice] = useState<Notice | null>(() =>
    initial.sentIds
      ? {
          kind: 'sent',
          ids: initial.sentIds,
          b0: 5,
          b1: 5 - initial.sentIds.length,
          t0: 2,
          t1: 2 + initial.sentIds.length,
        }
      : null,
  );
  const lanesId = useId();
  const kind = variant === 'phone' ? 'sheet' : 'dialog';
  const close = () => setOverlay({ kind: 'none' });
  const open = cards.find((card) => card.id === openId) ?? null;

  const toggle = (id: number) =>
    setSelected((now) => (now.includes(id) ? now.filter((item) => item !== id) : [...now, id]));

  const confirmSend = (target: SendTarget) => {
    const b0 = countIn(cards, 'backlog');
    const t0 = countIn(cards, 'todo');
    setCards((all) =>
      all.map((card) =>
        target.ids.includes(card.id)
          ? { ...card, lane: 'todo', sent: true }
          : { ...card, sent: false },
      ),
    );
    setNotice({
      kind: 'sent',
      ids: target.ids,
      b0,
      b1: b0 - target.ids.length,
      t0,
      t1: t0 + target.ids.length,
    });
    setSelected([]);
    setLane('todo');
    close();
  };

  const moveBack = (ids: number[]) => {
    setCards((all) =>
      all.map((card) => (ids.includes(card.id) ? { ...card, lane: 'backlog', sent: false } : card)),
    );
    setNotice(null);
    setLane('backlog');
  };

  const sendOne = (id: number) => {
    const card = cards.find((item) => item.id === id);
    if (!card) return;
    setOverlay({ kind: 'send', target: { scope: 'one', epicId: card.epicId, ids: [id] } });
  };
  const sendSelected = (epicId: string) =>
    setOverlay({
      kind: 'send',
      target: {
        scope: 'cards',
        epicId,
        ids: selected.filter((id) => cards.find((card) => card.id === id)?.epicId === epicId),
      },
    });
  const sendEpic = (epicId: string) =>
    setOverlay({
      kind: 'send',
      target: {
        scope: 'epic',
        epicId,
        ids: cards.filter((c) => c.epicId === epicId && c.lane === 'backlog').map((c) => c.id),
      },
    });

  const lanes: LaneActions = {
    fixture,
    cards,
    selected,
    openId,
    onToggle: toggle,
    onOpenCard: (id) => {
      setOpenId(id);
      setTab('description');
    },
    onPlan: (epicId) => setOverlay({ kind: 'plan', epicId }),
    onSendEpic: sendEpic,
    onSendSelected: sendSelected,
    onSendOne: sendOne,
    onClearSelection: () => setSelected([]),
  };
  const noticeView = notice && (
    <NoticeBar notice={notice} onUndo={moveBack} onDismiss={() => setNotice(null)} />
  );

  const laneName = (name: Lane) => m[name];
  const history = (card: MockCard) =>
    card.lane === 'backlog'
      ? ja
        ? 'AI が計画を作り、Backlog に置きました。'
        : 'The AI wrote the plan and put it in Backlog.'
      : ja
        ? '人が Todo へ送りました。'
        : 'A person sent it to Todo.';

  const detail = (statusLabels: 'pc' | 'monitor') =>
    open && (
      <DetailPane
        fixture={fixture}
        card={open}
        history={history(open)}
        tab={tab}
        onTab={setTab}
        onClose={() => setOpenId(null)}
        statusLabels={statusLabels}
        onToggleCondition={(conditionId, done) =>
          setCards((all) =>
            all.map((card) =>
              card.id === open.id
                ? {
                    ...card,
                    conditions: card.conditions.map((item: AcceptanceItem) =>
                      item.id === conditionId ? { ...item, done } : item,
                    ),
                  }
                : card,
            ),
          )
        }
        onEdit={() => setOverlay({ kind: 'edit', id: open.id })}
        onSend={() => sendOne(open.id)}
        onBack={() => moveBack([open.id])}
        onOpenEpic={(epicId) => setOverlay({ kind: 'plan', epicId })}
      />
    );

  const editing = overlay.kind === 'edit' ? cards.find((c) => c.id === overlay.id) : null;
  return (
    <>
      {variant === 'desktop' ? (
        <div className="bapp">
          <Header canAdd onAdd={() => {}} />
          <main className="bboard">
            {noticeView}
            <div className="bboard__row">
              <div className="board__lanes bboard__lanes">
                {LANES.map((name) => (
                  <section
                    key={name}
                    className="lane blane"
                    data-column={name}
                    data-lane={name}
                    aria-label={laneName(name)}
                  >
                    <header className="lane-header">
                      <h2 className="lane-header__name">{laneName(name)}</h2>
                      <span className="lane-header__count">{countIn(cards, name)}</span>
                    </header>
                    {name === 'backlog' && <p className="blane__hint">{m.backlogHint}</p>}
                    <div className="lane__scroll">
                      <div className="lane__cards">
                        <LaneBody lane={name} a={lanes} />
                      </div>
                    </div>
                  </section>
                ))}
              </div>
              {open && <div className="bboard__detail">{detail('pc')}</div>}
            </div>
          </main>
        </div>
      ) : (
        <main className="monitor-shell bphone">
          <Header settingsSize="l" />
          {noticeView}
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
                onClick={() => setLane(name)}
              >
                <span className="lane-tabs__name">{laneName(name)}</span>
                <strong className="lane-tabs__count">{countIn(cards, name)}</strong>
              </button>
            ))}
          </div>
          <p className="bphone__hint" data-lane={lane}>
            {lane === 'backlog' ? m.backlogHint : lane === 'todo' ? m.todoHint : ''}
          </p>
          <div className="bphone__lane blane" id={lanesId} data-lane={lane}>
            <LaneBody lane={lane} a={lanes} />
          </div>
          <Drawer
            open={open !== null && overlay.kind === 'none'}
            onOpenChange={(isOpen) => !isOpen && setOpenId(null)}
            identity={open ? `#${open.id}` : ''}
            title={open?.title ?? ''}
            className="bdrawer"
          >
            {detail('monitor')}
          </Drawer>
        </main>
      )}
      {overlay.kind === 'plan' && (
        <EpicPlan
          kind={kind}
          fixture={fixture}
          cards={cards}
          epicId={overlay.epicId}
          selected={selected}
          onToggle={toggle}
          onEdit={(id) => setOverlay({ kind: 'edit', id })}
          onSendSelected={() => sendSelected(overlay.epicId)}
          onSendEpic={() => sendEpic(overlay.epicId)}
          onClose={close}
        />
      )}
      {editing && (
        <EditSurface
          kind={kind}
          card={editing}
          onClose={close}
          onSave={(change) => {
            setCards((all) => patch(all, editing.id, { ...change, edited: true }));
            setNotice({ kind: 'saved', id: editing.id });
            close();
          }}
        />
      )}
      {overlay.kind === 'send' && overlay.target.ids.length > 0 && (
        <SendSurface
          kind={kind}
          fixture={fixture}
          cards={cards}
          target={overlay.target}
          onClose={close}
          onConfirm={() => confirmSend(overlay.target)}
        />
      )}
    </>
  );
}
