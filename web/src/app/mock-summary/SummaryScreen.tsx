import { Trash2Icon, XIcon } from 'lucide-react';
import { type CSSProperties, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../features/tasks/messages/messages.css';
import { useCardGesture } from '../../pages/monitor/hooks/useCardGesture';
import {
  actionsWidth,
  type RevealSide,
  revealOffset,
  revealProgress,
} from '../../pages/monitor/model/lanes';
import { PhoneNavBar } from '../../pages/monitor/components/PhoneNavBar';
import { buildSummaries, OPEN_QUESTIONS, type Summary, type SummarySet } from './data';
import { useIsJa, useMockText } from './text';
import '../../pages/monitor/components/monitor-lanes.css';
import './summary-mock.css';

type Variant = 'desktop' | 'phone';
type Tab = 'fromAi' | 'fromYou' | 'summary';

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
 * One summary. Tapping it shows the trash button on its right. On a phone it is
 * the board card's own swipe: `useCardGesture` slides it left and the trash tile grows from a dot,
 * drawn with the card's `swipe-card__*` styles. The gesture is always on for a summary (no hold
 * first), and while it is on `useSideSwipe` keeps the item's horizontal moves from reaching an
 * outer swipe area, so a swipe that starts on an item never switches the tab.
 */
function SummaryItem({ summary, variant, revealed, onOpen, onReveal, onDelete }: ItemProps) {
  const m = useMockText();
  const ref = useRef<HTMLDivElement>(null);
  const side: RevealSide | null = revealed ? 'right' : null;
  const rightWidth = actionsWidth(1);
  const { drag, consumesClick, handlers } = useCardGesture(ref, {
    revealed: side,
    onRevealChange: (next) => onReveal(next === 'right'),
    armed: true,
    onArm: () => {},
    leftWidth: 0,
    rightWidth,
    disabled: variant !== 'phone',
  });
  const offset = drag ?? revealOffset(side, 0, rightWidth);

  const content = (
    <>
      <button
        type="button"
        className="sm-item__head"
        onClick={() => {
          if (consumesClick()) return;
          onOpen();
        }}
      >
        <span className="sm-item__window">{summary.window}</span>
      </button>
      <ResultList summary={summary} />
    </>
  );
  const itemProps = {
    className: 'sm-item',
    'data-variant': variant,
    'data-revealed': revealed || undefined,
  };

  if (variant === 'desktop') {
    return (
      <li {...itemProps}>
        <button type="button" className="sm-item__trash" aria-label={m.delete} onClick={onDelete}>
          <Trash2Icon aria-hidden="true" />
        </button>
        <div className="sm-item__body">{content}</div>
      </li>
    );
  }
  return (
    <li {...itemProps}>
      <div
        ref={ref}
        className="swipe-card"
        data-dragging={drag !== null || undefined}
        {...handlers}
      >
        <div
          className="swipe-card__actions"
          data-side="right"
          data-revealed={offset < 0 || undefined}
          style={
            {
              width: `${offset < 0 ? Math.min(rightWidth, Math.abs(offset)) : 0}px`,
              '--reveal': offset < 0 ? revealProgress(offset, rightWidth) : 0,
            } as CSSProperties
          }
        >
          <button
            type="button"
            data-swipe-action
            className="swipe-card__tile swipe-card__tile--archive"
            tabIndex={revealed ? 0 : -1}
            aria-hidden={!revealed}
            aria-label={m.delete}
            onClick={onDelete}
          >
            <Trash2Icon aria-hidden="true" />
          </button>
        </div>
        <div
          className="swipe-card__body sm-item__body"
          style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
        >
          {content}
        </div>
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
  const shown = useMemo(() => items.filter((s) => !s.dismissed), [items]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'fromAi', label: t('messages.list.tabFromAi'), count: OPEN_QUESTIONS },
    { id: 'fromYou', label: t('messages.list.tabFromYou'), count: 1 },
    { id: 'summary', label: m.tab, count: shown.length },
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
          ) : shown.length === 0 ? (
            <Empty />
          ) : (
            <ul className="sm-list" aria-label={m.itemsLabel}>
              {shown.map((summary) => (
                <SummaryItem
                  key={summary.id}
                  summary={summary}
                  variant={variant ?? 'desktop'}
                  revealed={revealed === summary.id}
                  onOpen={() => {
                    setRevealed((current) => (current === summary.id ? null : summary.id));
                  }}
                  onReveal={(open) => setRevealed(open ? summary.id : null)}
                  onDelete={() => {
                    setItems((all) =>
                      all.map((s) => (s.id === summary.id ? { ...s, dismissed: true } : s)),
                    );
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
