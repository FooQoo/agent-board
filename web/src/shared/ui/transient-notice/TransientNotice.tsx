import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './TransientNotice.css';

const SHOW_MS = 6000;

/**
 * A short message at the bottom of the screen that goes away by itself. It is for the outcome of an
 * action that has no dialog to report in, such as a move that was refused. It is drawn at the body
 * so that it stays above the board and any open sheet.
 */
export function TransientNotice({
  message,
  onDismiss,
  durationMs = SHOW_MS,
}: {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss, durationMs]);
  if (message === null) return null;
  return createPortal(
    <div className="transient-notice" role="status">
      {message}
    </div>,
    document.body,
  );
}
