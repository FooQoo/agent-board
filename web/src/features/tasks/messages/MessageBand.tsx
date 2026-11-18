import { ArrowRightLeftIcon, ChevronRightIcon, CircleCheckIcon, SparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Message } from '@/shared/data/api/contracts';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { countMessages, type MessageTab } from './model/messages';
import './message-band.css';

export interface MessageBandProps {
  /** The open messages of the project. */
  messages: readonly Message[];
  /** `board`: the PC band above the lanes. `phone`: the monitor's band under its header. */
  variant: 'board' | 'phone';
  /** Opens the list, on the tab of the count that was pressed, or on "AI's questions" without one. */
  onOpen: (tab?: MessageTab) => void;
  /**
   * "Ask AI". The board header carries that button on the PC, so only the phone band shows one,
   * and only when it is given.
   */
  onAsk?: () => void;
}

/**
 * The band above the lanes: how many questions wait on you, and how many of your
 * requests no agent has picked up. It is never left out; with nothing to do it says so with a
 * count of 0.
 */
export function MessageBand({ messages, variant, onOpen, onAsk }: MessageBandProps) {
  const { t } = useTranslation();
  const count = countMessages(messages);
  const idle = count.fromAi === 0;
  const Icon = idle ? CircleCheckIcon : ArrowRightLeftIcon;
  const withAsk = variant === 'phone' && onAsk !== undefined;
  return (
    <section
      className="message-band"
      data-variant={variant}
      data-state={idle ? 'empty' : 'open'}
      aria-label={t('messages.title')}
    >
      <header className="message-band__header">
        <h2 className="message-band__heading">
          <Icon className="message-band__icon" aria-hidden="true" />
          <span className="message-band__title">{t('messages.title')}</span>
        </h2>
        <ul className="message-band__chips">
          <li>
            <Badge asChild variant={idle ? 'muted' : 'pending'} className="message-band__chip">
              <button type="button" onClick={() => onOpen('fromAi')}>
                {t('messages.band.fromAi')} <strong>{count.fromAi}</strong>
              </button>
            </Badge>
          </li>
          <li>
            <Badge asChild variant="outline" className="message-band__chip">
              <button type="button" onClick={() => onOpen('fromYou')}>
                {t('messages.band.fromYou')} <strong>{count.fromYou}</strong>
              </button>
            </Badge>
          </li>
        </ul>
        <div className="message-band__actions">
          {withAsk && (
            <Button type="button" size="s" onClick={onAsk}>
              <SparklesIcon aria-hidden="true" />
              {t('messages.band.ask')}
            </Button>
          )}
          <Button
            type="button"
            size="s"
            variant={withAsk ? 'outline' : 'default'}
            onClick={() => onOpen()}
          >
            {t('messages.band.open')}
            <ChevronRightIcon className="message-band__chevron" aria-hidden="true" />
          </Button>
        </div>
      </header>
    </section>
  );
}
