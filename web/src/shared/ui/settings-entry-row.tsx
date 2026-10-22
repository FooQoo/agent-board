import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import '../styles/settings-entry.css';

/**
 * One entry row of the settings dialog: an icon tile, a title over one line of description, and an
 * outlined button that opens the feature. The tutorial and the mobile connection share it, so both
 * rows look and wrap the same.
 */
export function SettingsEntryRow({
  icon: Icon,
  title,
  body,
  action,
  onOpen,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  /** The button's label. */
  action: string;
  onOpen: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <section className="settings-entry" aria-labelledby={titleId}>
      <div className="settings-entry__grid">
        <span className="settings-entry__icon" aria-hidden="true">
          <Icon />
        </span>
        <div className="settings-entry__copy">
          <h3 id={titleId} className="settings-entry__title">
            {title}
          </h3>
          <p id={bodyId} className="settings-entry__body">
            {body}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="m"
          className="settings-entry__action"
          aria-describedby={bodyId}
          onClick={onOpen}
        >
          {action}
        </Button>
      </div>
    </section>
  );
}
