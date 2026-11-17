import { useCallback, useState } from 'react';
import type { MessageTab } from './model/messages';

/** Where the list opens: on a tab, or straight on one message. */
export interface MessagesPanelTarget {
  tab?: MessageTab;
  openId?: string | null;
}

export interface MessagesPanelController {
  /** The list is open at this target, or null while it is closed. */
  target: MessagesPanelTarget | null;
  open: (target?: MessagesPanelTarget) => void;
  close: () => void;
}

/** The open state of the list, kept by the screen so a card's button can open it at a question. */
export function useMessagesPanel(): MessagesPanelController {
  const [target, setTarget] = useState<MessagesPanelTarget | null>(null);
  const open = useCallback((next: MessagesPanelTarget = {}) => setTarget(next), []);
  const close = useCallback(() => setTarget(null), []);
  return { target, open, close };
}
