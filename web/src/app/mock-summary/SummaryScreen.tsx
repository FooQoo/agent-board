import { Trash2Icon, XIcon } from 'lucide-react';
import { type PointerEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../features/tasks/messages/messages.css';
import { PhoneNavBar } from '../../pages/monitor/components/PhoneNavBar';
import { buildSummaries, OPEN_QUESTIONS, type Summary, type SummarySet } from './data';
import { useIsJa, useMockText } from './text';
import './summary-mock.css';

type Variant = 'desktop' | 'phone';
type Tab = 'fromAi' | 'fromYou' | 'summary';

/** How far the item slides to show the trash button, in px. */
const REVEAL = 76;
/** A sideways move this long (px) decides between a swipe and a tap or a scroll. */
const INTENT = 8;

export interface SummaryScreenProps {
  variant: Variant;
  /** Which fixed summaries to list. */
  set?: SummarySet;
  /** The item whose trash button is already shown. */
  revealedId?: string;
}

function ResultList({ summary }: { summary: Summary }) {
  const m = useMockText();
  return (
    <ul className="sm-results" aria-label={m.resultsLabel}>
      {summary.results.map((result) => (
        <li key={result.id} className="sm-result">
          <span className="sm-result__id">#{result.id}</span>
          <span className="sm-result__title">{result.title}</span>
        </li>
      ))}
    </ul>
  );
}

interface ItemProps {
  summary: Summary;
  variant: Variant;
  revealed: boolean;
  onOpen: () => void;
  onReveal: (open: boolean) => void;
  onDelete: () => void;
}

/**
 * One summary. Tapping it marks it read and shows the trash button on its right. On a phone a
 * sideways swipe slides it open the same way; on a PC the button also appears on hover or focus.
 */
function SummaryItem({ summary, variant, revealed, onOpen, onReveal, onDelete }: ItemProps) {
  const m = useMockText();
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; from: number; id: number } | null>(null);
  const swiped = useRef(false);

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (variant !== 'phone') return;
    start.current = {
      x: event.clientX,
      y: event.clientY,
      from: revealed ? -REVEAL : 0,
      id: event.pointerId,
    };
    swiped.current = false;
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = event.clientX - s.x;
    const dy = event.clientY - s.y;
    if (!swiped.current) {
      if (Math.abs(dx) < INTENT || Math.abs(dx) < Math.abs(dy)) return;
      swiped.current = true;
      event.currentTarget.setPointerCapture(s.id);
    }
    setDrag(Math.max(-REVEAL, Math.min(0, s.from + dx)));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s || !swiped.current || drag === null) return;
    onReveal(drag < -REVEAL / 2);
    setDrag(null);
  };

  const shift = drag ?? (revealed ? -REVEAL : 0);
  return (
    <li
      className="sm-item"
      data-variant={variant}
      data-unread={summary.read ? undefined : ''}
      data-revealed={revealed || undefined}
      data-swiping={drag !== null || undefined}
    >
      <button
        type="button"
        className="sm-item__trash"
        aria-label={m.delete}
        tabIndex={revealed || variant === 'desktop' ? 0 : -1}
        onClick={onDelete}
      >
        <Trash2Icon aria-hidden="true" />
      </button>
      <div
        className="sm-item__body"
        style={{ transform: variant === 'phone' ? `translateX(${shift}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <button
          type="button"
          className="sm-item__head"
          onClick={() => {
            if (swiped.current) return;
            onOpen();
          }}
        >
          <span className="sm-dot" aria-hidden="true" />
          <span className="sm-item__window">{summary.window}</span>
          <span className="sm-state" data-unread={summary.read ? undefined : ''}>
            {summary.read ? m.read : m.unread}
          </span>
        </button>
        <ResultList summary={summary} />
      </div>
    </li>
  );
}

function Empty() {
  const m = useMockText();
  return (
    <div className="sm-empty">
      <p className="sm-empty__title">{m.emptyTitle}</p>
      <p className="sm-empty__body">{m.emptyBody}</p>
    </div>
  );
}

function Panel({ variant, set, revealedId }: SummaryScreenProps) {
  const m = useMockText();
  const { t } = useTranslation();
  const ja = useIsJa();
  const [items, setItems] = useState(() => buildSummaries(set ?? 'mixed', ja));
  const [revealed, setRevealed] = useState<string | null>(revealedId ?? null);
  const [tab, setTab] = useState<Tab>('summary');
  const unread = useMemo(() => items.filter((s) => !s.read).length, [items]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'fromAi', label: t('messages.list.tabFromAi'), count: OPEN_QUESTIONS },
    { id: 'fromYou', label: t('messages.list.tabFromYou'), count: 1 },
    { id: 'summary', label: m.tab, count: unread },
  ];

  return (
    <section className="sm-panel" data-variant={variant} aria-label={t('messages.title')}>
      <header className="sm-panel__head">
        {variant === 'phone' && <span className="sm-grab" aria-hidden="true" />}
        <h2>{t('messages.title')}</h2>
        {variant === 'desktop' && (
          <button type="button" className="sm-close" aria-label={t('messages.list.close')}>
            <XIcon aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="sm-panel__body">
        <div className="message-list">
          <div className="message-tabs" role="tablist" aria-label={t('messages.list.tabs')}>
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                className="message-tabs__tab"
                data-unread={item.id === 'summary' && item.count > 0 ? '' : undefined}
                aria-selected={item.id === tab}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                <strong>{item.count}</strong>
              </button>
            ))}
          </div>
          {tab !== 'summary' ? (
            <p className="message-list__empty">{m.otherTab}</p>
          ) : items.length === 0 ? (
            <Empty />
          ) : (
            <ul className="sm-list" aria-label={m.itemsLabel}>
              {items.map((summary) => (
                <SummaryItem
                  key={summary.id}
                  summary={summary}
                  variant={variant ?? 'desktop'}
                  revealed={revealed === summary.id}
                  onOpen={() => {
                    setItems((all) =>
                      all.map((s) => (s.id === summary.id ? { ...s, read: true } : s)),
                    );
                    setRevealed((current) => (current === summary.id ? null : summary.id));
                  }}
                  onReveal={(open) => setRevealed(open ? summary.id : null)}
                  onDelete={() => {
                    setItems((all) => all.filter((s) => s.id !== summary.id));
                    setRevealed(null);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** The messages area with the new Summary tab: a PC modal, or the phone's Messages sheet above the bottom bar. */
export function SummaryScreen({ variant, set = 'mixed', revealedId }: SummaryScreenProps) {
  // The state starts from the props; a new `set` or `revealedId` from the toolbar remounts it.
  const key = `${set}:${revealedId ?? ''}`;
  if (variant === 'desktop') {
    return (
      <div className="sm-root sm-root--desktop">
        <div className="sm-backdrop" aria-hidden="true" />
        <Panel key={key} variant="desktop" set={set} revealedId={revealedId} />
      </div>
    );
  }
  return (
    <div className="sm-root sm-root--phone">
      <div className="sm-phone-top" aria-hidden="true" />
      <Panel key={key} variant="phone" set={set} revealedId={revealedId} />
      <PhoneNavBar
        current="messages"
        questionCount={OPEN_QUESTIONS}
        onBoard={() => {}}
        onMessages={() => {}}
        onAsk={() => {}}
        onArchive={() => {}}
        onSettings={() => {}}
      />
    </div>
  );
}
