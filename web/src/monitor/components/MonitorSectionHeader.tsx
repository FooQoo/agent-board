import { CheckIcon, CircleDashedIcon, CircleIcon, LoaderIcon, PauseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

export type MonitorSection = 'pending' | 'running' | 'todo' | 'doing' | 'done';
const icons: Record<MonitorSection, ReactNode> = {
  pending: <PauseIcon aria-hidden="true" />,
  running: <LoaderIcon aria-hidden="true" />,
  todo: <CircleIcon aria-hidden="true" />,
  doing: <CircleDashedIcon aria-hidden="true" />,
  done: <CheckIcon aria-hidden="true" />,
};

/** The header title: pending and running name the work the agent needs or does; the lanes keep their names. */
function titleKey(section: MonitorSection): string {
  return section === 'pending' || section === 'running'
    ? `monitor.section.${section}`
    : `monitor.status.${section}`;
}

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
      aria-label={`${t(titleKey(section))} ${count}`}
    >
      {icons[section]}
      <span>{t(titleKey(section))}</span>
      <strong>{count}</strong>
    </h2>
  );
}
