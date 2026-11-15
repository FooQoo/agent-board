import { useTranslation } from 'react-i18next';
import { LANES } from '../model/lanes';
import type { MonitorSection } from './MonitorSectionHeader';
import './monitor-lanes.css';

export type LaneCounts = Record<MonitorSection, number | '—'>;

/**
 * The tab bar under the header and the questions band: one tab for each lane with its count. The
 * current lane is highlighted; a tap switches to it. Each tab is a 44px touch target.
 */
export function LaneTabs({
  lane,
  counts,
  controlsId,
  onLaneChange,
}: {
  lane: MonitorSection;
  counts: LaneCounts;
  /** The id of the lanes viewport the tabs control. */
  controlsId?: string;
  onLaneChange: (lane: MonitorSection) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="lane-tabs" role="tablist" aria-label={t('monitor.lanes.tabs')}>
      {LANES.map((name) => {
        const selected = name === lane;
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
            <span className="lane-tabs__name">{t(`monitor.status.${name}`)}</span>
            <strong className="lane-tabs__count">{counts[name]}</strong>
          </button>
        );
      })}
    </div>
  );
}
