import { useTranslation } from 'react-i18next';
import { ListChecksIcon } from 'lucide-react';
import type { AcceptanceItem, Task } from '../../../shared/api/contracts';
import { AcceptanceList } from '../acceptance/AcceptanceList';
import { progressOf } from '../acceptance/model/acceptance';
import './acceptance-tab.css';

/** Read-only completion conditions of the task. Epic references stay in the epic details. */
export function AcceptanceTabView({
  task,
}: {
  task: Pick<Task, 'acceptance' | 'acceptanceError'>;
}) {
  const { t } = useTranslation();
  return (
    <div className="acceptance-tab">
      <ConditionSection
        title={t('detail.conditionsCard')}
        items={task.acceptance}
        unreadable={task.acceptanceError}
      />
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
