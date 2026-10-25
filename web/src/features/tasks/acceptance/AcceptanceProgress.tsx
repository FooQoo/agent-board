import { CircleCheckIcon, ListChecksIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { progressOf } from './model/acceptance';
import type { TaskSummary } from '../../../shared/api/contracts';
import './acceptance.css';

/**
 * The number of conditions done on a card, shown on the card and on the monitor. Nothing is shown for
 * a card without conditions; a card whose frontmatter cannot be read says so.
 */
export function AcceptanceProgress({
  task,
}: {
  task: Pick<TaskSummary, 'acceptance' | 'acceptanceError'>;
}) {
  const { t } = useTranslation();
  if (task.acceptanceError) {
    return (
      <span className="acceptance-chip acceptance-chip--error" role="status">
        <TriangleAlertIcon aria-hidden="true" focusable="false" />
        <span>{t('acceptance.unreadable')}</span>
      </span>
    );
  }
  const { done, total, complete } = progressOf(task.acceptance);
  if (total === 0) return null;
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
