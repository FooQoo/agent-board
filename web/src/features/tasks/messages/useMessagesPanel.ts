import { useCallback, useRef, useState } from 'react';
import type { MessageTab } from './model/messages';

/** Where the list opens: on a tab, or straight on one message. */
export interface MessagesPanelTarget {
  tab?: MessageTab;
  openId?: string | null;
  /** The scroll position of the list to restore when it opens (back from a summary result). */
  scrollTop?: number;
}

export interface MessagesPanelController {
  /** The list is open at this target, or null while it is closed. */
  target: MessagesPanelTarget | null;
  open: (target?: MessagesPanelTarget) => void;
  close: () => void;
  /** A summary result was opened in the page: the list closes, and `returnToList` brings it back. */
  leaveForResult: (scrollTop: number) => void;
  /** Reopens the Summary tab where `leaveForResult` left it; does nothing when nothing was left. */
  returnToList: () => void;
}

/** The open state of the list, kept by the screen so a card's button can open it at a question. */
export function useMessagesPanel(): MessagesPanelController {
  const [target, setTarget] = useState<MessagesPanelTarget | null>(null);
  // The Summary list a result was opened from; kept outside the open state, which is null meanwhile.
  const returnTo = useRef<MessagesPanelTarget | null>(null);
  const open = useCallback((next: MessagesPanelTarget = {}) => {
    returnTo.current = null;
    setTarget(next);
  }, []);
  const close = useCallback(() => {
    returnTo.current = null;
    setTarget(null);
  }, []);
  const leaveForResult = useCallback((scrollTop: number) => {
    returnTo.current = { tab: 'summary', scrollTop };
    setTarget(null);
  }, []);
  const returnToList = useCallback(() => {
    const back = returnTo.current;
    returnTo.current = null;
    if (back !== null) setTarget(back);
  }, []);
  return { target, open, close, leaveForResult, returnToList };
}
