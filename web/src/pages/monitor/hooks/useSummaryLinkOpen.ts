import { useEffect, useRef } from 'react';
import type { MessagesPanelController } from '../../../features/tasks/messages/useMessagesPanel';

/**
 * `?messages=summary` opens the list on the Summary tab once; closing it ends the request.
 * Without the messages API (the demo, sample data) there is no list to open.
 */
export function useSummaryLinkOpen(
  panel: MessagesPanelController,
  requested: boolean | undefined,
  hasMessages: boolean,
  onClose: (() => void) | undefined,
) {
  const opened = useRef(false);
  const { open } = panel;
  const closed = panel.target === null;
  useEffect(() => {
    if (!requested || !hasMessages) return;
    if (!opened.current) {
      opened.current = true;
      open({ tab: 'summary' });
    } else if (closed) {
      opened.current = false;
      onClose?.();
    }
  }, [requested, hasMessages, open, closed, onClose]);
}
