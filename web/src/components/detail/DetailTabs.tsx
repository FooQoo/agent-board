import { FileTextIcon, HistoryIcon } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type DetailTab = 'description' | 'history';

const ORDER: DetailTab[] = ['description', 'history'];

export function tabId(base: string, tab: DetailTab): string {
  return `${base}-tab-${tab}`;
}

export function panelId(base: string, tab: DetailTab): string {
  return `${base}-panel-${tab}`;
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const home = event.key === 'Home';
    const end = event.key === 'End';
    if (step === 0 && !home && !end) return;
    event.preventDefault();
    const current = ORDER.indexOf(tab);
    const next = home ? 0 : end ? ORDER.length - 1 : (current + step + ORDER.length) % ORDER.length;
    const target = ORDER[next] as DetailTab;
    onChange(target);
    document.getElementById(tabId(idBase, target))?.focus();
  };

  return (
    <div className="detail__tabs">
      <div className="detail__tablist" role="tablist" onKeyDown={onKeyDown}>
        <button
          type="button"
          role="tab"
          id={tabId(idBase, 'description')}
          aria-selected={tab === 'description'}
          aria-controls={panelId(idBase, 'description')}
          tabIndex={tab === 'description' ? 0 : -1}
          className="detail__tab"
          onClick={() => onChange('description')}
        >
          <FileTextIcon aria-hidden="true" />
          {t('detail.tabDescription')}
        </button>
        <button
          type="button"
          role="tab"
          id={tabId(idBase, 'history')}
          aria-selected={tab === 'history'}
          aria-controls={panelId(idBase, 'history')}
          tabIndex={tab === 'history' ? 0 : -1}
          className="detail__tab"
          onClick={() => onChange('history')}
        >
          <HistoryIcon aria-hidden="true" />
          {t('detail.tabHistory')} <span className="detail__tab-count">{historyCount}</span>
        </button>
      </div>
      {children}
    </div>
  );
}
