import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * An icon followed by its text, inside a Button. The icon box and the gap are fixed here, so every
 * button reads the same. A glyph that does not fill its box (the plus) passes the unused space on
 * its text side as `optical`, so the visible gap to the text matches the other icons.
 */
export function IconLabel({
  icon: Icon,
  optical = 0,
  children,
}: {
  icon: LucideIcon;
  /** Unused space, in px, between the glyph and the text beyond what a full-width glyph has. */
  optical?: number;
  children: ReactNode;
}) {
  return (
    <span className="icon-label">
      <Icon aria-hidden="true" style={optical ? { marginRight: -optical } : undefined} />
      {children}
    </span>
  );
}
