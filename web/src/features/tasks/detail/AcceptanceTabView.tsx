import { useTranslation } from 'react-i18next';
import { ListChecksIcon } from 'lucide-react';
import type { AcceptanceItem, Task } from '../../../shared/api/contracts';
import type { AttachmentResolver } from '../../../shared/markdown/model';
import { AcceptanceList } from '../acceptance/AcceptanceList';
import { progressOf } from '../acceptance/model/acceptance';
import { useConditionToggle } from '../acceptance/model/useConditionToggle';
import './acceptance-tab.css';

/**
 * The task's own completion conditions. With `onToggle` the person can check and uncheck them; the
 * choice shows at once and is undone if saving fails. Epic references stay in the epic details.
 */
export function AcceptanceTabView({
  task,
  onToggle,
  resolveAttachment,
}: {
  task: Pick<Task, 'acceptance' | 'acceptanceError'>;
  onToggle?: (conditionId: string, done: boolean) => Promise<unknown>;
  /** Turns an `attachment:<id>` image into its URL. */
  resolveAttachment?: AttachmentResolver;
}) {
  const { t } = useTranslation();
  return (
    <div className="acceptance-tab">
      <ConditionSection
        title={t('detail.conditionsCard')}
        items={task.acceptance}
        unreadable={task.acceptanceError}
        onToggle={onToggle}
        resolveAttachment={resolveAttachment}
      />
    </div>
  );
}

function ConditionSection({
  title,
  items,
  unreadable,
  onToggle,
  resolveAttachment,
}: {
  title: string;
  items: readonly AcceptanceItem[];
  unreadable: boolean;
  onToggle?: (conditionId: string, done: boolean) => Promise<unknown>;
  resolveAttachment?: AttachmentResolver;
}) {
  const { t } = useTranslation();
  const toggle = useConditionToggle(items, onToggle);
  const { done, total } = progressOf(toggle.items);
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
        <AcceptanceList
          items={toggle.items}
          onToggle={onToggle ? toggle.change : undefined}
          busy={toggle.busy}
          resolveAttachment={resolveAttachment}
        />
      ) : (
        <p>{t('detail.conditionsEmpty')}</p>
      )}
      {toggle.failed && (
        <p className="acceptance-tab__error" role="alert">
          {t('acceptance.toggleFailed')}
        </p>
      )}
    </section>
  );
}
