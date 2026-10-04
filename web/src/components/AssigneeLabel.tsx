import { useTranslation } from 'react-i18next';
import type { Assignee } from '../types';

export function AssigneeLabel({ assignee }: { assignee: Assignee }) {
  const { t } = useTranslation();
  return (
    <span className={`assignee-label assignee-label--${assignee}`}>
      {t(`assignee.${assignee}`)}
    </span>
  );
}
