import { useCallback, useEffect, useState } from 'react';
import type { ProjectId } from '@/shared/api/contracts';
import type { MessageDetail, MessagesApi } from './model/messages';

export interface MessageDetailState {
  detail: MessageDetail | null;
  state: 'loading' | 'ready' | 'failed';
  reload: () => void;
}

/** Reads the message that is opened (none while the list shows), and reads it again on `reload`. */
export function useMessageDetail(
  read: MessagesApi['read'],
  projectId: ProjectId,
  messageId: string | null,
): MessageDetailState {
  const [loaded, setLoaded] = useState<MessageDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the reason to read again.
  useEffect(() => {
    if (messageId === null) return;
    let live = true;
    setFailed(false);
    read(projectId, messageId).then(
      (detail) => {
        if (live) setLoaded(detail);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [read, projectId, messageId, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const detail = messageId !== null && loaded?.id === messageId ? loaded : null;
  return { detail, state: detail !== null ? 'ready' : failed ? 'failed' : 'loading', reload };
}
