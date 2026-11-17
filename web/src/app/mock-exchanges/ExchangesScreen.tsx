import { SettingsIcon, SparklesIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { LaneTabs } from '../../pages/monitor/components/LaneTabs';
import type { MonitorSection } from '../../pages/monitor/components/MonitorSectionHeader';
import { LaneHeader } from '../../pages/board/ui/LaneHeader';
import { Header } from '../../shared/ui/app-header/Header';
import { TaskCardView } from '../../features/tasks/card/TaskCard';
import { Button } from '@/shared/ui/button';
import { IconLabel } from '@/shared/ui/icon-label';
import { AskAiDialog } from './AskAiDialog';
import {
  buildFixture,
  openQuestionsOf,
  type Fixture,
  type MockExchange,
  type Plan,
  type Scenario,
} from './data';
import { fixtureText } from './fixture-text';
import { ExchangeBand } from './ExchangeBand';
import { ExchangePanel, type ExchangeTab } from './ExchangePanel';
import { DraftTaskCard, PlanCard } from './PlanCards';
import { PlanReview } from './PlanReview';
import { useIsJa, useMockText } from './text';
import './exchanges-mock.css';

/** What is open above the screen. */
export type Overlay =
  | { kind: 'none' }
  | { kind: 'ask'; text?: string; images?: number; draft?: boolean }
  | { kind: 'panel'; tab?: ExchangeTab; openId?: string }
  | { kind: 'review'; planId: string };

export interface ExchangesScreenProps {
  scenario?: Scenario;
  variant?: 'desktop' | 'phone';
  initial?: Overlay;
}

/** The plan an approval row stands for: an epic's plan, or one draft task as a plan of its own. */
function planOf(fixture: Fixture, id: string): Plan | null {
  const plan = fixture.plans.find((item) => item.epicId === id);
  if (plan) return plan;
  const draft = fixture.drafts.find((item) => `#${item.id}` === id);
  if (!draft) return null;
  return {
    epicId: '',
    epicName: '',
    kind: 'single',
    goal: '',
    tasks: [{ id: draft.id, title: draft.title, assignee: draft.assignee, acceptance: 1 }],
    questionIds: draft.questionIds,
  };
}

/** The board header with "Ask AI" in the place of the add-task button. */
export function BoardHeader({ onAsk }: { onAsk: () => void }) {
  const m = useMockText();
  return (
    <header className="header">
      <h1 className="header__app">
        <span className="header__logo">
          <img src={`${import.meta.env.BASE_URL}logo-white.png`} alt="" width="24" height="24" />
        </span>
        <span>Agent Board</span>
      </h1>
      <span className="header__slash" aria-hidden="true">
        /
      </span>
      <span className="header__board-name">agent-board</span>
      <span className="header__spacer" aria-hidden="true" />
      <Button type="button" className="header__add" onClick={onAsk}>
        <IconLabel icon={SparklesIcon}>{m.askAi}</IconLabel>
      </Button>
      <Button
        type="button"
        variant="outline"
        iconOnly
        className="header__settings"
        aria-label="Settings"
      >
        <SettingsIcon aria-hidden="true" />
      </Button>
    </header>
  );
}

/** The header the board has today, with the add-task button. Used only to compare in a Story. */
export function HeaderToday() {
  return <Header canAdd onAdd={() => {}} />;
}

function Cards({
  fixture,
  lane,
  onReview,
}: {
  fixture: Fixture;
  lane: MonitorSection;
  onReview: (planId: string) => void;
}) {
  const open = (ids: string[]) => openQuestionsOf(fixture, ids).length;
  return (
    <>
      {lane === 'todo' && (
        <>
          {fixture.plans.map((plan) => (
            <PlanCard
              key={plan.epicId}
              plan={plan}
              openQuestionCount={open(plan.questionIds)}
              onReview={() => onReview(plan.epicId)}
            />
          ))}
          {fixture.drafts.map((draft) => (
            <DraftTaskCard key={draft.id} draft={draft} onReview={() => onReview(`#${draft.id}`)} />
          ))}
        </>
      )}
      {fixture.lanes[lane].map((task) => (
        <TaskCardView key={task.id} task={task} selected={false} onSelect={() => {}} />
      ))}
    </>
  );
}

function laneCount(fixture: Fixture, lane: MonitorSection): number {
  const own = fixture.lanes[lane].length;
  return lane === 'todo' ? own + fixture.plans.length + fixture.drafts.length : own;
}

/**
 * The exchanges mock: the board (or the phone monitor) with its band, lanes and plan card, and the
 * dialogs or sheets that open from them. Every value is static; nothing is saved.
 */
export function ExchangesScreen({
  scenario = 'newEpic',
  variant = 'desktop',
  initial = { kind: 'none' },
}: ExchangesScreenProps) {
  const ja = useIsJa();
  const fixture = useMemo(() => buildFixture(ja, scenario), [ja, scenario]);
  const [overlay, setOverlay] = useState<Overlay>(initial);
  const [lane, setLane] = useState<MonitorSection>('todo');
  const lanesId = useId();
  const kind = variant === 'phone' ? 'sheet' : 'dialog';
  const close = () => setOverlay({ kind: 'none' });
  const band = (
    <ExchangeBand
      exchanges={fixture.exchanges}
      variant={variant === 'phone' ? 'phone' : 'board'}
      onOpen={() => setOverlay({ kind: 'panel' })}
    />
  );
  const review = overlay.kind === 'review' ? planOf(fixture, overlay.planId) : null;
  return (
    <>
      {variant === 'desktop' ? (
        <div className="xapp">
          <BoardHeader onAsk={() => setOverlay({ kind: 'ask' })} />
          <main className="board board--with-band">
            {band}
            <div className="board__lanes">
              {(['todo', 'doing', 'done'] as const).map((name) => (
                <section key={name} className="lane" data-column={name} aria-label={name}>
                  <LaneHeader column={name} count={laneCount(fixture, name)} />
                  <div className="lane__scroll">
                    <div className="lane__cards">
                      <Cards
                        fixture={fixture}
                        lane={name}
                        onReview={(planId) => setOverlay({ kind: 'review', planId })}
                      />
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </main>
        </div>
      ) : (
        <main className="monitor-shell">
          <Header settingsSize="l" />
          {band}
          <LaneTabs
            lane={lane}
            controlsId={lanesId}
            counts={{
              todo: laneCount(fixture, 'todo'),
              doing: laneCount(fixture, 'doing'),
              done: laneCount(fixture, 'done'),
            }}
            onLaneChange={setLane}
          />
          <div className="xphone-lane" id={lanesId}>
            <Cards
              fixture={fixture}
              lane={lane}
              onReview={(planId) => setOverlay({ kind: 'review', planId })}
            />
          </div>
        </main>
      )}
      {overlay.kind === 'ask' && (
        <AskAiDialog
          onClose={close}
          initialText={overlay.draft ? fixtureText(ja).askDraft : overlay.text}
          initialImages={overlay.images}
        />
      )}
      {overlay.kind === 'panel' && (
        <ExchangePanel
          kind={kind}
          exchanges={fixture.exchanges}
          initialTab={overlay.tab}
          initialOpenId={overlay.openId ?? null}
          onClose={close}
          onOpenPlan={(exchange: MockExchange) =>
            setOverlay({ kind: 'review', planId: exchange.id })
          }
        />
      )}
      {review && overlay.kind === 'review' && (
        <PlanReview
          kind={kind}
          plan={review}
          openQuestions={openQuestionsOf(fixture, review.questionIds)}
          onClose={close}
          onAnswer={(question) => setOverlay({ kind: 'panel', openId: question.id })}
        />
      )}
    </>
  );
}
