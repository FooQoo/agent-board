import { PauseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Card } from '../../types';

/** Read-only rendering of a pending decision request shared by PC and monitor detail. */
export function DecisionRequestContent({ card }: { card: Card }) {
  const { t } = useTranslation();
  if (card.agentStatus !== 'pending' || card.pendingReason === null) return null;
  return (
    <section className="detail__request" aria-label={t('request.title')}>
      <p className="detail__banner-head">
        <PauseIcon aria-hidden="true" />
        <span>{t('request.title')}</span>
      </p>
      <p className="detail__reason">{card.pendingReason}</p>
      {card.pendingChoices.length > 0 && (
        <ul className="detail__read-choices" aria-label={t('request.choices')}>
          {card.pendingChoices.map((choice) => (
            <li className="detail__read-choice" key={choice.id}>
              {choice.label}
            </li>
          ))}
        </ul>
      )}
      <p className="detail__read-guide">{t('request.readOnlyGuide')}</p>
    </section>
  );
}
