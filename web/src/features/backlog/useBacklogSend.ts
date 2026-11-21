import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId, TaskSummary } from '../../shared/api/contracts';
import { type BacklogTarget, sendEpicTasks, sendTasks, withOpenQuestions } from './send';

export interface BacklogSend {
  /** The cards waiting for the person to confirm the warning, or `null`. */
  confirming: {
    ids: number[];
    warned: TaskSummary[];
    epicId?: string;
    /** The lane the cards go to. */
    to: BacklogTarget;
  } | null;
  busy: boolean;
  /** The failure of the last send, as a sentence for a notice, or `null`. A send that went through has none. */
  notice: string | null;
  dismissNotice: () => void;
  /** Sends the cards, or asks for the confirmation first when one of them has an open question. */
  request: (ids: readonly number[], epicId?: string, to?: BacklogTarget) => boolean;
  confirm: () => void;
  cancel: () => void;
}

/**
 * The send of Backlog cards, shared by the PC board and the phone: to Todo, or on the PC board to
 * Doing or Done. Cards with an open question are confirmed first (the warning names them and the
 * lane); only a failure or a partial send shows a notice, because the cards moving is the answer.
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
    async (ids: readonly number[], ack: boolean, epicId?: string, to: BacklogTarget = 'todo') => {
      if (projectId === null || running.current || ids.length === 0) return;
      running.current = true;
      setBusy(true);
      const lane = t(`column.${to}`);
      try {
        const { sent, failed } = epicId
          ? await sendEpicTasks(projectId, epicId, ids, ack)
          : await sendTasks(projectId, ids, ack, to);
        const k = to === 'todo' ? 'backlog' : 'backlog.move';
        if (sent.length === 0) setNotice(t(`${k}.failed`, { lane }));
        else if (failed.length > 0)
          setNotice(
            t(`${k}.partial`, { sent: sent.length, total: ids.length, failed: failed.length }),
          );
        // A send that went through shows no notice: the cards moving is the answer.
      } finally {
        running.current = false;
        setBusy(false);
        setConfirming(null);
        onSent();
      }
    },
    [projectId, onSent, t, setConfirming],
  );

  const request = useCallback(
    (ids: readonly number[], epicId?: string, to: BacklogTarget = 'todo') => {
      if (ids.length === 0 || running.current) return false;
      const warned = withOpenQuestions(tasks, ids);
      if (warned.length > 0) {
        setConfirming({ ids: [...ids], warned, epicId, to });
        return false;
      }
      void run(ids, false, epicId, to);
      return true;
    },
    [tasks, run, setConfirming],
  );
  const confirm = useCallback(() => {
    if (confirming) void run(confirming.ids, true, confirming.epicId, confirming.to);
  }, [confirming, run]);
  const cancel = useCallback(() => setConfirming(null), [setConfirming]);
  return { confirming, busy, notice, dismissNotice, request, confirm, cancel };
}
