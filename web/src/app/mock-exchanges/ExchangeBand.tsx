import { ArrowRightLeftIcon, ChevronRightIcon, CircleCheckIcon, SparklesIcon } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import '../../features/tasks/answer/question-band.css';
import './exchanges-mock.css';
import { countExchanges, type MockExchange } from './data';
import { useMockText } from './text';

/** The band above the lanes that replaces the unanswered-questions band: the AI's open questions and your open requests. */
export function ExchangeBand({
  exchanges,
  variant,
  onOpen,
  onAsk,
}: {
  exchanges: MockExchange[];
  variant: 'board' | 'phone';
  onOpen: () => void;
  /** Phone only: the board header carries "Ask AI" on the desktop, so the phone band does. */
  onAsk?: () => void;
}) {
  const m = useMockText();
  const count = countExchanges(exchanges);
  const idle = count.fromAi === 0;
  const Icon = idle ? CircleCheckIcon : ArrowRightLeftIcon;
  return (
    <section
      className="question-band xband"
      data-variant={variant}
      data-state={idle ? 'empty' : 'open'}
      aria-label={m.bandTitle}
    >
      <header className="question-band__header xband__header">
        <h2 className="question-band__heading">
          <span className="question-band__toggle xband__title">
            <Icon className="question-band__icon" aria-hidden="true" />
            <span className="question-band__title">{m.bandTitle}</span>
          </span>
        </h2>
        <ul className="xband__chips">
          <li>
            <Badge variant={count.fromAi === 0 ? 'muted' : 'pending'} className="xband__chip">
              {m.bandFromAi} <strong>{count.fromAi}</strong>
              {count.fromAi > 0 && (
                <span className="xband__sub">
                  （{m.bandBreakdown(count.questions, count.approvals)}）
                </span>
              )}
            </Badge>
          </li>
          <li>
            <Badge variant="outline" className="xband__chip">
              {m.bandFromYou} <strong>{count.fromYou}</strong>
              {count.fromYou > 0 && <span className="xband__sub">（{m.bandUnpicked}）</span>}
            </Badge>
          </li>
        </ul>
        <div className="xband__actions">
          {variant === 'phone' && onAsk && (
            <Button type="button" size="s" className="xband__ask" onClick={onAsk}>
              <SparklesIcon aria-hidden="true" />
              {m.askAi}
            </Button>
          )}
          <Button
            type="button"
            size="s"
            variant={variant === 'phone' && onAsk ? 'outline' : 'default'}
            className="xband__open"
            onClick={onOpen}
          >
            {m.bandOpen}
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      </header>
    </section>
  );
}
