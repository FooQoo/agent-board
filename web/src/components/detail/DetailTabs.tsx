import { FileTextIcon, HistoryIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DetailTabList, detailPanelId, detailTabId } from '../ui/detail-tabs';

export type DetailTab = 'description' | 'history';

export function tabId(base: string, tab: DetailTab): string {
  return detailTabId(base, tab);
}

export function panelId(base: string, tab: DetailTab): string {
  return detailPanelId(base, tab);
}

/** The two tabs of the detail column, with the toolbar to their right. */
export function DetailTabs({
  idBase,
  tab,
  historyCount,
  onChange,
  children,
}: {
  idBase: string;
  tab: DetailTab;
  historyCount: number;
  onChange: (tab: DetailTab) => void;
  /** The toolbar. */
  children: ReactNode;
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
        ]}
      />
      {children}
    </div>
  );
}
