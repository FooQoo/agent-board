import { CircleCheckIcon, ListChecksIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { progressOf } from '../../lib/acceptance';
import type { Card } from '../../types';
import './acceptance.css';

/**
 * The number of conditions done on a card, shown on the card and on the monitor. Nothing is shown for
 * a card without conditions; a card whose frontmatter cannot be read says so.
 */
export function AcceptanceProgress({ card }: { card: Card }) {
  const { t } = useTranslation();
  if (card.acceptanceError) {
    return (
      <span className="acceptance-chip acceptance-chip--error" role="status">
        <TriangleAlertIcon aria-hidden="true" focusable="false" />
        <span>{t('acceptance.unreadable')}</span>
      </span>
    );
  }
  if (card.acceptance.length === 0) return null;
  const { done, total, complete } = progressOf(card.acceptance);
  const progress = t('acceptance.progress', { done, total });
  const label = `${t('acceptance.title')} ${progress}`;
  return (
    <span className="acceptance-chip" data-complete={complete ? 'true' : undefined} title={label}>
      {complete ? (
        <CircleCheckIcon aria-hidden="true" focusable="false" />
      ) : (
        <ListChecksIcon aria-hidden="true" focusable="false" />
      )}
      <span>{t('acceptance.chip', { done, total })}</span>
    </span>
  );
}
