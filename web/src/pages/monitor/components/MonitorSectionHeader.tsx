import { CheckIcon, CircleDashedIcon, CircleIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

export type MonitorSection = 'todo' | 'doing' | 'done';
const icons: Record<MonitorSection, ReactNode> = {
  todo: <CircleIcon aria-hidden="true" />,
  doing: <CircleDashedIcon aria-hidden="true" />,
  done: <CheckIcon aria-hidden="true" />,
};

export function MonitorSectionHeader({
  section,
  count,
}: {
  section: MonitorSection;
  count: number | '—';
}) {
  const { t } = useTranslation();
  return (
    <h2
      className="monitor-section-header"
      data-section={section}
      aria-label={`${t(`monitor.status.${section}`)} ${count}`}
    >
      {icons[section]}
      <span>{t(`monitor.status.${section}`)}</span>
      <strong>{count}</strong>
    </h2>
  );
}
