import { ArrowLeftIcon, ClipboardCheckIcon, CircleHelpIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { DecisionAnswerFields } from '../../features/tasks/answer/DecisionAnswerFields';
import type { DecisionAnswerView } from '../../features/tasks/answer/decisionAnswerView';
import { DecisionQuestion } from '../../features/tasks/answer/DecisionQuestion';
import { resolveAttachment, type MockExchange } from './data';
import { Surface } from './Surface';
import { type MockText, useMockText } from './text';
import './exchanges-mock.css';

export type ExchangeTab = 'fromAi' | 'fromYou';

const TYPE_ICONS = {
  question: CircleHelpIcon,
  request: SendIcon,
  approval: ClipboardCheckIcon,
} as const;

function typeLabel(m: MockText, type: MockExchange['type']): string {
  return type === 'question' ? m.typeQuestion : type === 'request' ? m.typeRequest : m.typeApproval;
}

/** "11/17 08:40", from the fixed timestamps of the fixtures. */
function shortTime(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

/** Which tab a row belongs to. Closed exchanges are not listed: nobody goes back to read them here. */
export function tabOf(exchange: MockExchange): ExchangeTab | null {
  if (exchange.turn === null) return null;
  return exchange.from === 'ai' ? 'fromAi' : 'fromYou';
}

function TurnBadge({ exchange }: { exchange: MockExchange }) {
  const m = useMockText();
  if (exchange.turn === 'human')
    return (
      <Badge variant="pending">
        {exchange.type === 'approval' ? m.awaitingApproval : m.unanswered}
      </Badge>
    );
  if (exchange.turn === 'ai') {
    // A request nobody picked up yet: say so, so it is clear that no agent has it.
    return <Badge variant="muted">{m.waitingPickup}</Badge>;
  }
  const done = exchange.type === 'request' ? m.accepted : m.replied;
  return <Badge variant="muted">{done}</Badge>;
}

/** One row: the kind, the direction, its state and the first line. */
function ExchangeRow({ exchange, onOpen }: { exchange: MockExchange; onOpen: () => void }) {
  const m = useMockText();
  const Icon = TYPE_ICONS[exchange.type];
  const direction = exchange.to === 'human' ? m.dirToYou : m.dirToAi;
  return (
    <li>
      <button type="button" className="xrow" data-type={exchange.type} onClick={onOpen}>
        <span className="xrow__icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="xrow__main">
          <span className="xrow__meta">
            <span>{typeLabel(m, exchange.type)}</span>
            <span>{direction}</span>
            <span className="xrow__id">{exchange.id}</span>
            <span>{shortTime(exchange.createdAt)}</span>
          </span>
          <span className="xrow__title">{exchange.title}</span>
        </span>
        <TurnBadge exchange={exchange} />
      </button>
    </li>
  );
}

type AnswerState = ReturnType<typeof useAnswerState>;

function useAnswerState() {
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const hasInput = choiceId !== null || text.trim() !== '';
  const view: DecisionAnswerView = {
    choiceId,
    text,
    phase: 'editing',
    notice: null,
    failure: null,
    tooLong: false,
    sendable: hasInput,
    disabled: false,
    hasInput,
  };
  return {
    view,
    onChoiceChange: setChoiceId,
    onTextChange: setText,
    onClear: () => {
      setChoiceId(null);
      setText('');
    },
  };
}

/**
 * An opened question: the question on the left and the answer on the right, as in the product's
 * answer dialog (the `decision-panel` rules split them inside a `decision-dialog`). The buttons are
 * not here: the surface pins them in its footer.
 */
function QuestionDetail({
  exchange,
  answer,
  onBack,
}: {
  exchange: MockExchange;
  answer: AnswerState;
  onBack: () => void;
}) {
  const m = useMockText();
  const answered = exchange.turn === null;
  const head = (
    <>
      <Button type="button" variant="outline" size="s" className="xdetail__back" onClick={onBack}>
        <ArrowLeftIcon aria-hidden="true" />
        {m.back}
      </Button>
      {exchange.tasks.length > 0 && (
        <p className="xdetail__blocks">
          {m.blocks(exchange.tasks.map((id) => `#${id}`).join(' '))}
        </p>
      )}
    </>
  );
  const question = exchange.body ?? exchange.title;
  if (answered)
    return (
      <div className="xdetail">
        {head}
        <DecisionQuestion question={question} />
      </div>
    );
  return (
    <div className="decision-panel xdetail xdetail--panel">
      <div className="decision-panel__question xdetail__question">
        {head}
        <DecisionQuestion question={question} resolveAttachment={resolveAttachment} />
      </div>
      <div className="decision-panel__answer">
        <DecisionAnswerFields
          choices={exchange.choices ?? []}
          view={answer.view}
          onChoiceChange={answer.onChoiceChange}
          onTextChange={answer.onTextChange}
          onClear={answer.onClear}
        />
      </div>
    </div>
  );
}

/** An opened request: the text you sent. The AI's only reply is "accepted". */
function RequestDetail({ exchange, onBack }: { exchange: MockExchange; onBack: () => void }) {
  const m = useMockText();
  return (
    <div className="xdetail">
      <Button type="button" variant="outline" size="s" className="xdetail__back" onClick={onBack}>
        <ArrowLeftIcon aria-hidden="true" />
        {m.back}
      </Button>
      <p className="xdetail__blocks">{m.requestNoReply}</p>
      <DecisionQuestion
        question={exchange.body ?? exchange.title}
        resolveAttachment={resolveAttachment}
      />
      {exchange.turn === 'ai' && (
        <div className="xdetail__bar">
          <Button type="button" variant="outline" className="xdetail__withdraw" onClick={onBack}>
            {m.withdraw}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The list of open exchanges in two tabs, and the opened exchange in its place. An approval
 * does not open here: it opens the plan review.
 */
export function ExchangePanelBody({
  exchanges,
  tab,
  onTabChange,
  openId,
  onOpenChange,
  onOpenPlan,
  answer,
}: {
  exchanges: MockExchange[];
  tab: ExchangeTab;
  onTabChange: (tab: ExchangeTab) => void;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  onOpenPlan: (exchange: MockExchange) => void;
  /** The answer being written in an opened question; the panel keeps it for the footer buttons. */
  answer: AnswerState;
}) {
  const m = useMockText();
  const opened = exchanges.find((exchange) => exchange.id === openId);
  if (opened?.type === 'question')
    return <QuestionDetail exchange={opened} answer={answer} onBack={() => onOpenChange(null)} />;
  if (opened?.type === 'request')
    return <RequestDetail exchange={opened} onBack={() => onOpenChange(null)} />;
  const tabs: { id: ExchangeTab; label: string }[] = [
    { id: 'fromAi', label: m.tabFromAi },
    { id: 'fromYou', label: m.tabFromYou },
  ];
  const rows = exchanges.filter((exchange) => tabOf(exchange) === tab);
  return (
    <div className="xpanel">
      <div className="xtabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="xtabs__tab"
            aria-selected={item.id === tab}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
            <strong>{exchanges.filter((exchange) => tabOf(exchange) === item.id).length}</strong>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="xpanel__empty">{m.emptyTab}</p>
      ) : (
        <ul className="xpanel__list">
          {rows.map((exchange) => (
            <ExchangeRow
              key={exchange.id}
              exchange={exchange}
              onOpen={() =>
                exchange.type === 'approval' ? onOpenPlan(exchange) : onOpenChange(exchange.id)
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The panel as a modal on the board or a bottom sheet on a phone, with its own open state. */
export function ExchangePanel({
  kind,
  exchanges,
  initialTab = 'fromAi',
  initialOpenId = null,
  onClose,
  onOpenPlan,
}: {
  kind: 'dialog' | 'sheet';
  exchanges: MockExchange[];
  initialTab?: ExchangeTab;
  initialOpenId?: string | null;
  onClose: () => void;
  onOpenPlan: (exchange: MockExchange) => void;
}) {
  const m = useMockText();
  const [tab, setTab] = useState<ExchangeTab>(initialTab);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const answer = useAnswerState();
  const opened = exchanges.find((exchange) => exchange.id === openId);
  // An open question that still waits for you: the modal takes the answer dialog's size and the
  // buttons stay pinned in the footer.
  const answering = opened?.type === 'question' && opened.turn !== null;
  return (
    <Surface
      kind={kind}
      title={m.panelTitle}
      onClose={onClose}
      className={answering ? 'xpanel-surface xmodal--decision decision-dialog' : 'xpanel-surface'}
      footer={
        answering && (
          <div className="xdetail__bar">
            <Button type="button" variant="outline" onClick={onClose}>
              {m.later}
            </Button>
            <Button type="button" disabled={!answer.view.sendable}>
              {m.answerSend}
            </Button>
          </div>
        )
      }
    >
      <ExchangePanelBody
        exchanges={exchanges}
        tab={tab}
        onTabChange={setTab}
        openId={openId}
        onOpenChange={setOpenId}
        onOpenPlan={onOpenPlan}
        answer={answer}
      />
    </Surface>
  );
}
