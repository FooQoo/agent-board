import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/classnames/utils';

/**
 * The row of buttons that ends a dialog or a confirm. It alone decides their size, width and
 * placement, so a dialog never sizes its own buttons: `m` for dialogs, `s` for a confirm inside a
 * panel; the buttons of a row are equal columns, as wide as the longest label.
 */
export function DialogActions({
  size = 'm',
  align = 'end',
  className,
  children,
}: {
  size?: 's' | 'm';
  /** `between` puts the first button at the left edge and the last at the right edge. */
  align?: 'end' | 'start' | 'between';
  /** Only for the layout hooks of the parent (stacking on a phone); never for sizes. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('dialog-actions', className)} data-size={size} data-align={align}>
      {children}
    </div>
  );
}
