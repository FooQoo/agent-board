import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { LANES } from '../model/lanes';
import { type MonitorSection, SECTION_ICONS } from './MonitorSectionHeader';
import './monitor-lanes.css';

export type LaneCounts = Record<MonitorSection, number | '—'>;

/**
 * The tab bar under the header and the questions band: one tab for each lane with its count. A
 * marker sits under the current lane and slides with the lanes while a finger moves them (the
 * carousel writes `--lane-progress` through `ref`); a tap switches lanes. Each tab is a 44px
 * touch target.
 */
export function LaneTabs({
  ref,
  lane,
  counts,
  controlsId,
  onLaneChange,
}: {
  ref?: Ref<HTMLDivElement>;
  lane: MonitorSection;
  counts: LaneCounts;
  /** The id of the lanes viewport the tabs control. */
  controlsId?: string;
  onLaneChange: (lane: MonitorSection) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      ref={ref}
      className="lane-tabs"
      role="tablist"
      aria-label={t('monitor.lanes.tabs')}
      data-lane={lane}
    >
      {LANES.map((name) => {
        const selected = name === lane;
        const Icon = SECTION_ICONS[name];
        return (
          <button
            key={name}
            type="button"
            role="tab"
            id={`lane-tab-${name}`}
            aria-selected={selected}
            aria-controls={controlsId}
            aria-label={t('monitor.lanes.tab', {
              lane: t(`monitor.status.${name}`),
              count: counts[name],
            })}
            className="lane-tabs__tab"
            data-lane={name}
            onClick={() => onLaneChange(name)}
          >
            <Icon className="lane-tabs__icon" aria-hidden="true" />
            <span className="lane-tabs__name">{t(`monitor.status.${name}`)}</span>
            <strong className="lane-tabs__count">{counts[name]}</strong>
          </button>
        );
      })}
    </div>
  );
}
