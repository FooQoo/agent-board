import { useCallback, useRef, useState } from 'react';
import type { ProjectId, TaskSummary } from '../../shared/api/contracts';
import { type BacklogTarget, sendTask, withOpenQuestions } from './send';

/** What the screen shows for a single-card move: the same shape as `BacklogSend`, so one layer draws both. */
export interface BacklogMove {
  /** The card waiting for the person to confirm the warning about an open question, or `null`. */
  confirming: {
    ids: number[];
    warned: TaskSummary[];
    to: BacklogTarget;
  } | null;
  /** The confirmed move is running. A move with no warning shows no busy state: it is already on screen. */
  busy: boolean;
  /** The reason a refused move gives, or `null`. A move that went through has no notice. */
  notice: string | null;
  dismissNotice: () => void;
  /** Moves one Backlog card, or asks for the confirmation first when it has an open question. */
  request: (id: number, to?: BacklogTarget) => void;
  confirm: () => void;
  cancel: () => void;
}

/**
 * The move of one Backlog card to Todo, Doing or Done, as a person does it with a swipe tile, a plain
 * drag, or the send button of the details. It is a normal lane move: the card is in the target lane at
 * once (`apply`), the server is asked once for that card, and a refusal puts the card back (`revert`)
 * and says why in a notice. It never touches the selection mode or the batch send of picked cards
 * (`useBacklogSend`). The only extra step is the confirmation of an open question, which the rules
 * require.
 */
export function useBacklogMove(
  projectId: ProjectId | null,
  tasks: readonly TaskSummary[],
  {
    apply,
    revert,
    onDone,
    refusal,
  }: {
    /** Shows the card in the target lane before the server has answered. */
    apply: (id: number, to: BacklogTarget) => void;
    /** Takes the card back to the Backlog when the server refused. */
    revert: (id: number) => void;
    /** The move ended, in any way: the screen reads the project again. */
    onDone: () => void;
    /** The sentence for a notice when the server refused the move. */
    refusal: (cause: unknown) => string;
  },
): BacklogMove {
  const [pending, setPending] = useState<{
    projectId: ProjectId | null;
    value: NonNullable<BacklogMove['confirming']>;
  } | null>(null);
  // A pending confirmation belongs to the project that asked for it.
  const confirming = pending !== null && pending.projectId === projectId ? pending.value : null;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmed = useRef(false);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const run = useCallback(
    async (id: number, ack: boolean, to: BacklogTarget) => {
      if (projectId === null) return;
      apply(id, to);
      try {
        await sendTask(projectId, id, ack, to);
      } catch (cause) {
        revert(id);
        setNotice(refusal(cause));
      } finally {
        onDone();
      }
    },
    [projectId, apply, revert, onDone, refusal],
  );

  const request = useCallback(
    (id: number, to: BacklogTarget = 'todo') => {
      const warned = withOpenQuestions(tasks, [id]);
      if (warned.length > 0) {
        setPending({ projectId, value: { ids: [id], warned, to } });
        return;
      }
      void run(id, false, to);
    },
    [tasks, projectId, run],
  );
  const confirm = useCallback(() => {
    const id = confirming?.ids[0];
    if (!confirming || id === undefined || confirmed.current) return;
    confirmed.current = true;
    setBusy(true);
    void run(id, true, confirming.to).finally(() => {
      confirmed.current = false;
      setBusy(false);
      setPending(null);
    });
  }, [confirming, run]);
  const cancel = useCallback(() => setPending(null), []);
  return { confirming, busy, notice, dismissNotice, request, confirm, cancel };
}
