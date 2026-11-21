import { SendIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { useDrawerDrag } from '@/shared/ui/use-drawer-drag';
import '../../shared/styles/backlog.css';

/** The longest the sheet's slide down takes, in ms; a sheet whose animation never reports its end is removed after it. */
const EXIT_FALLBACK_MS = 400;

/** The custom property that tells the lane how much of its foot the open sheet covers (px). */
const HEIGHT_VAR = '--backlog-sheet-height';

/**
 * The phone's selection mode as a short bottom drawer of its own: a handle and the two choices,
 * "Cancel" and "Send to Todo (N)". Unlike the detail and question sheets it is not modal: there is no
 * backdrop, a tap on the page behind does not close it, the focus is not trapped, and the cards stay
 * tappable and scrollable while it stands, so the person keeps picking. It closes only by Cancel,
 * Escape, a pull down on its handle, or once the cards were sent, and every close ends the mode.
 * It shares the sheet's look, slide animation and pull-down gesture (`useDrawerDrag`).
 */
export function BacklogSheet({
  open,
  count,
  busy,
  onCancel,
  onSend,
}: {
  open: boolean;
  count: number;
  busy?: boolean;
  /** Any way of closing the sheet: the parent leaves the selection mode. */
  onCancel: () => void;
  onSend: () => void;
}) {
  const { t } = useTranslation();
  const popup = useRef<HTMLElement>(null);
  const noBackdrop = useRef<HTMLElement>(null);
  const handle = useDrawerDrag({
    open,
    onOpenChange: (next) => !next && onCancel(),
    popup,
    overlay: noBackdrop,
    dismissible: !busy,
  });

  // The sheet stays mounted while it slides down.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // The lane keeps room under its last card for as tall as the sheet is.
  useEffect(() => {
    const node = popup.current;
    if (!mounted || !node) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty(HEIGHT_VAR, `${node.offsetHeight}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, [mounted]);

  if (!mounted) return null;
  return (
    <section
      ref={popup}
      className="backlog-sheet"
      data-state={open ? 'open' : 'closed'}
      aria-label={t('backlog.barLabel')}
      onAnimationEnd={(event) => {
        if (event.target === popup.current && !open) setMounted(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <div className="backlog-sheet__top" {...handle}>
        <button
          type="button"
          className="backlog-sheet__handle"
          aria-label={t('backlog.sheetDismiss')}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              onCancel();
            }
          }}
        >
          <span className="backlog-sheet__handle-indicator" aria-hidden="true" />
        </button>
      </div>
      <div className="backlog-sheet__actions">
        <span className="sr-only" role="status">
          {t('backlog.selected', { count })}
        </span>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {t('backlog.cancel')}
        </Button>
        <Button type="button" disabled={busy || count === 0} onClick={onSend}>
          <SendIcon aria-hidden="true" />
          {t('backlog.send', { count })}
        </Button>
      </div>
    </section>
  );
}
