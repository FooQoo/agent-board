import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import '../../styles/markdown.css';

/** One H2 section: a heading button with the count, and the body while it is open. */
export function SectionFold({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <section className="md-section">
      <h3 className="md-section__heading">
        <button
          type="button"
          className="md-section__toggle"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
        >
          {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
          <span className="md-section__title">{title}</span>{' '}
          <span className="md-section__count">{count}</span>
        </button>
      </h3>
      {open && (
        <div className="md-section__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
