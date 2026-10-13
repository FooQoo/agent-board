import { FileTextIcon, HistoryIcon, LayersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DetailTabList, detailPanelId, detailTabId } from '../ui/detail-tabs';

/** The three tabs of a card: its description, its history, and the epic it belongs to. */
export type DetailTab = 'description' | 'history' | 'epic';

export function tabId(base: string, tab: DetailTab): string {
  return detailTabId(base, tab);
}

export function panelId(base: string, tab: DetailTab): string {
  return detailPanelId(base, tab);
}

/** The three tabs of the detail column. The card's actions sit in the panel header, not beside the tabs. */
export function DetailTabs({
  idBase,
  tab,
  historyCount,
  onChange,
}: {
  idBase: string;
  tab: DetailTab;
  historyCount: number;
  onChange: (tab: DetailTab) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="detail__tabs">
      <DetailTabList
        idBase={idBase}
        selected={tab}
        onChange={onChange}
        tabs={[
          {
            id: 'description',
            label: t('detail.tabDescription'),
            icon: <FileTextIcon aria-hidden="true" />,
          },
          {
            id: 'history',
            label: t('detail.tabHistory'),
            icon: <HistoryIcon aria-hidden="true" />,
            count: historyCount,
          },
          {
            id: 'epic',
            label: t('detail.tabEpic'),
            icon: <LayersIcon aria-hidden="true" />,
          },
        ]}
      />
    </div>
  );
}
