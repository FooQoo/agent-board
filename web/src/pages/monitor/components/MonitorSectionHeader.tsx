import { CheckIcon, CircleDashedIcon, CircleDotDashedIcon, CircleIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';

export type MonitorSection = 'backlog' | 'todo' | 'doing' | 'done';
/** The mark of each lane, shared by the lane headers, the lane tabs, and the swipe tiles. */
export const SECTION_ICONS: Record<MonitorSection, LucideIcon> = {
  backlog: CircleDotDashedIcon,
  todo: CircleIcon,
  doing: CircleDashedIcon,
  done: CheckIcon,
};

export function MonitorSectionHeader({
  section,
  count,
}: {
  section: MonitorSection;
  count: number | '—';
}) {
  const { t } = useTranslation();
  const Icon = SECTION_ICONS[section];
  return (
    <h2
      className="monitor-section-header"
      data-section={section}
      aria-label={`${t(`monitor.status.${section}`)} ${count}`}
    >
      <Icon aria-hidden="true" />
      <span>{t(`monitor.status.${section}`)}</span>
      <strong>{count}</strong>
    </h2>
  );
}
