import { useCallback, useEffect } from 'react';
import type { Message } from '../../shared/data/api/contracts';
import { firstQuestionOfTask } from '../../features/tasks/messages/model/messages';
import {
  type MessagesPanelController,
  useMessagesPanel,
} from '../../features/tasks/messages/useMessagesPanel';

export interface MessagesController {
  /** Where the list of messages is open; it belongs to the project it was opened in. */
  panel: MessagesPanelController;
  /** A card's answer button: the list opens at the first open question the card waits on. */
  openForTask: (taskId: number) => void;
}

/** The PC board's list of messages. Another project closes it. */
export function useMessagesController(
  activeId: string | null,
  messages: readonly Message[] | null,
): MessagesController {
  const panel = useMessagesPanel();
  const { open, close } = panel;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is closed when the project changes.
  useEffect(() => close(), [activeId, close]);
  const openForTask = useCallback(
    (taskId: number) => {
      const first = firstQuestionOfTask(messages ?? [], taskId);
      open({ tab: 'fromAi', openId: first?.id ?? null });
    },
    [open, messages],
  );
  return { panel, openForTask };
}
