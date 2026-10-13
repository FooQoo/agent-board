import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId } from 'react';

/**
 * A panel of the editor's right column that folds. The header always shows; the content is kept
 * mounted while folded so a panel does not lose what it holds.
 */
export function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <section className="collapsible" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="collapsible__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <ChevronDownIcon aria-hidden="true" focusable="false" className="collapsible__chevron" />
        <span className="collapsible__title">{title}</span>
        {count !== undefined && <span className="collapsible__count">{count}</span>}
      </button>
      <div id={bodyId} className="collapsible__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
