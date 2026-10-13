import { useTranslation } from 'react-i18next';
import { ListChecksIcon } from 'lucide-react';
import type { AcceptanceItem, Card, Epic } from '../../types';
import { AcceptanceList } from '../acceptance/AcceptanceList';
import { Button } from '../ui/button';
import { progressOf } from '../../lib/acceptance';
import type { EpicTabStatus } from './EpicTabView';
import './acceptance-tab.css';

/** Read-only conditions, separate from the card and epic documents. */
export function AcceptanceTabView({
  card,
  epic,
  epicStatus,
  onRetryEpic,
}: {
  card: Pick<Card, 'acceptance' | 'acceptanceError'>;
  epic: Epic | null;
  epicStatus: EpicTabStatus;
  onRetryEpic?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="acceptance-tab">
      <ConditionSection
        title={t('detail.conditionsCard')}
        items={card.acceptance}
        unreadable={card.acceptanceError}
      />
      {epicStatus === 'ready' && epic ? (
        <ConditionSection
          title={t('detail.conditionsEpic')}
          items={epic.acceptance ?? []}
          unreadable={epic.acceptanceError || !Array.isArray(epic.acceptance)}
        />
      ) : epicStatus !== 'none' ? (
        <section className="acceptance-tab__section">
          <h3 className="acceptance-tab__title">{t('detail.conditionsEpic')}</h3>
          <p role={epicStatus === 'loading' ? 'status' : 'alert'}>
            {t(epicStatus === 'loading' ? 'detail.epicLoading' : 'detail.epicFailed')}
          </p>
          {epicStatus === 'failed' && onRetryEpic && (
            <Button type="button" variant="outline" size="sm" onClick={onRetryEpic}>
              {t('detail.epicRetry')}
            </Button>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ConditionSection({
  title,
  items,
  unreadable,
}: {
  title: string;
  items: readonly AcceptanceItem[];
  unreadable: boolean;
}) {
  const { t } = useTranslation();
  const { done, total } = progressOf(items);
  return (
    <section className="acceptance-tab__section" aria-label={title}>
      <header className="acceptance-tab__header">
        <ListChecksIcon aria-hidden="true" />
        <h3 className="acceptance-tab__title">{title}</h3>
        {!unreadable && <span>{t('acceptance.progress', { done, total })}</span>}
      </header>
      {unreadable ? (
        <p role="status">{t('acceptance.unreadableTitle')}</p>
      ) : items.length ? (
        <AcceptanceList items={items} />
      ) : (
        <p>{t('detail.conditionsEmpty')}</p>
      )}
    </section>
  );
}
