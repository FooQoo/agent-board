import { useTranslation } from 'react-i18next';
import { Bot, User } from './icons';
import type { Assignee } from '../types';

export function AssigneeLabel({ assignee }: { assignee: Assignee }) {
  const { t } = useTranslation();
  return (
    <span className={`assignee-label assignee-label--${assignee}`}>
      {assignee === 'ai' ? <Bot /> : <User />}
      {t(`assignee.${assignee}`)}
    </span>
  );
}
