import { useId, type KeyboardEvent, type ReactNode } from 'react';

export interface DetailTabOption<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
  count?: number;
}

export function detailTabId(base: string, tab: string): string {
  return `${base}-tab-${tab}`;
}

export function detailPanelId(base: string, tab: string): string {
  return `${base}-panel-${tab}`;
}

/** Accessible tablist shared by the PC detail column and the mobile detail drawer. */
export function DetailTabList<T extends string>({
  idBase,
  tabs,
  selected,
  onChange,
  wrap = true,
  className = 'detail__tablist',
}: {
  idBase?: string;
  tabs: readonly DetailTabOption<T>[];
  selected: T;
  onChange(tab: T): void;
  wrap?: boolean;
  className?: string;
}) {
  const generatedId = useId();
  const base = idBase ?? generatedId;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const first = event.key === 'Home';
    const last = event.key === 'End';
    if (!direction && !first && !last) return;
    event.preventDefault();
    const current = tabs.findIndex((tab) => tab.id === selected);
    const raw = first ? 0 : last ? tabs.length - 1 : current + direction;
    const next = wrap
      ? (raw + tabs.length) % tabs.length
      : Math.max(0, Math.min(tabs.length - 1, raw));
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.id);
    document.getElementById(detailTabId(base, tab.id))?.focus();
  };

  return (
    <div className={className} role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={detailTabId(base, tab.id)}
          aria-selected={selected === tab.id}
          aria-controls={detailPanelId(base, tab.id)}
          tabIndex={selected === tab.id ? 0 : -1}
          className="detail__tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && (
            <>
              {' '}
              <span className="detail__tab-count">{tab.count}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
