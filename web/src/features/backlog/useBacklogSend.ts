import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId, TaskSummary } from '../../shared/api/contracts';
import { sendEpicTasks, sendTasks, withOpenQuestions } from './send';

export interface BacklogSend {
  /** The cards waiting for the person to confirm the warning, or `null`. */
  confirming: { ids: number[]; warned: TaskSummary[]; epicId?: string } | null;
  busy: boolean;
  /** The result of the last send, as a sentence for a notice, or `null`. */
  notice: string | null;
  dismissNotice: () => void;
  /** Sends the cards, or asks for the confirmation first when one of them has an open question. */
  request: (ids: readonly number[], epicId?: string) => boolean;
  confirm: () => void;
  cancel: () => void;
}

/**
 * The send-to-Todo operation of the Backlog cards, shared by the PC board and the phone. Cards with
 * an open question are confirmed first (the warning names them); the result is a notice with the
 * counts of Backlog and Todo before and after.
 */
export function useBacklogSend(
  projectId: ProjectId | null,
  tasks: readonly TaskSummary[],
  onSent: () => void,
): BacklogSend {
  const { t } = useTranslation();
  // A pending confirmation belongs to the project that asked for it: after a project change it is
  // neither shown nor confirmed.
  const [pending, setPending] = useState<{
    projectId: ProjectId | null;
    value: NonNullable<BacklogSend['confirming']>;
  } | null>(null);
  const confirming = pending !== null && pending.projectId === projectId ? pending.value : null;
  const setConfirming = useCallback(
    (value: BacklogSend['confirming']) => setPending(value && { projectId, value }),
    [projectId],
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const running = useRef(false);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const run = useCallback(
    async (ids: readonly number[], ack: boolean, epicId?: string) => {
      if (projectId === null || running.current || ids.length === 0) return;
      running.current = true;
      setBusy(true);
      const count = (lane: TaskSummary['taskStatus']) =>
        tasks.filter((task) => task.taskStatus === lane).length;
      const backlogBefore = count('backlog');
      const todoBefore = count('todo');
      try {
        const { sent, failed } = epicId
          ? await sendEpicTasks(projectId, epicId, ids, ack)
          : await sendTasks(projectId, ids, ack);
        if (sent.length === 0) setNotice(t('backlog.failed'));
        else if (failed.length > 0)
          setNotice(
            t('backlog.partial', { sent: sent.length, total: ids.length, failed: failed.length }),
          );
        else
          setNotice(
            `${sent.length === 1 ? t('backlog.sentOne') : t('backlog.sentMany', { count: sent.length })} ${t('backlog.counts', { backlogBefore, backlogAfter: backlogBefore - sent.length, todoBefore, todoAfter: todoBefore + sent.length })}`,
          );
      } finally {
        running.current = false;
        setBusy(false);
        setConfirming(null);
        onSent();
      }
    },
    [projectId, tasks, onSent, t, setConfirming],
  );

  const request = useCallback(
    (ids: readonly number[], epicId?: string) => {
      if (ids.length === 0 || running.current) return false;
      const warned = withOpenQuestions(tasks, ids);
      if (warned.length > 0) {
        setConfirming({ ids: [...ids], warned, epicId });
        return false;
      }
      void run(ids, false, epicId);
      return true;
    },
    [tasks, run, setConfirming],
  );
  const confirm = useCallback(() => {
    if (confirming) void run(confirming.ids, true, confirming.epicId);
  }, [confirming, run]);
  const cancel = useCallback(() => setConfirming(null), [setConfirming]);
  return { confirming, busy, notice, dismissNotice, request, confirm, cancel };
}
