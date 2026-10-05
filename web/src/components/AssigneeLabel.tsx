import { BotIcon, UserRoundIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Assignee } from '../types';

/** The assignee as a robot (AI) or person (user) icon; the accessible name carries the meaning. */
export function AssigneeLabel({ assignee }: { assignee: Assignee }) {
  const { t } = useTranslation();
  return (
    <span
      className={`assignee-label assignee-label--${assignee}`}
      role="img"
      aria-label={t(`assignee.${assignee}`)}
      title={t(`assignee.${assignee}`)}
    >
      {assignee === 'ai' ? <BotIcon aria-hidden="true" /> : <UserRoundIcon aria-hidden="true" />}
    </span>
  );
}
