import { useCallback, useEffect, useRef, useState } from 'react';
import { WriteError } from '../../api/writeErrors';

export type PreviewProblem = 'running' | 'conflict' | 'failed' | null;

export interface UsePreviewLockOptions {
  /** The item was already a draft when the modal opened. */
  draftAtOpen: boolean;
  /** Running or archived: nothing can be edited. */
  readOnly: boolean;
  /** The editor differs from what it showed. */
  dirty: boolean;
  /** The savable fields as one string; compared by content, never by `updatedAt`. */
  snapshot: string;
  /** Makes the item a draft and returns the snapshot of what the server holds then. */
  enter: () => Promise<string>;
  /** Takes the draft back (discard). */
  leave: () => Promise<void>;
}

export interface PreviewLock {
  entered: boolean;
  problem: PreviewProblem;
  canSave: boolean;
  release: () => Promise<void>;
  /** Enters again after `running` or `failed`; nothing otherwise. */
  retry: () => void;
}

/**
 * The draft lock of the preview modal. The first difference enters a draft once. A refusal
 * because the item is running reports `running`, any other failure `failed`; both leave the
 * input as it is and enter again at the next input (or when the modal stops being read-only).
 * A draft whose content differs from what the modal showed before the edit is a `conflict`,
 * which stays while the modal is open.
 */
export function usePreviewLock({
  draftAtOpen,
  readOnly,
  dirty,
  snapshot,
  enter,
  leave,
}: UsePreviewLockOptions): PreviewLock {
  const [entered, setEntered] = useState(false);
  const [problem, setProblem] = useState<PreviewProblem>(null);
  const enteredRef = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  /** What the modal showed while it had no difference. */
  const baseline = useRef(snapshot);
  const latest = useRef({ enter, leave });
  latest.current = { enter, leave };
  if (!dirty && !enteredRef.current) baseline.current = snapshot;

  const view = useRef({ dirty, readOnly, draftAtOpen, problem });
  view.current = { dirty, readOnly, draftAtOpen, problem };

  const attempt = useCallback(() => {
    const now = view.current;
    if (!now.dirty || now.draftAtOpen || now.readOnly) return;
    if (enteredRef.current || pending.current !== null) return;
    const before = baseline.current;
    const run = (async () => {
      try {
        const held = await latest.current.enter();
        enteredRef.current = true;
        setEntered(true);
        setProblem(held === before ? null : 'conflict');
      } catch (error) {
        const refused = error instanceof WriteError && error.code === 'invalid_state_for_draft';
        setProblem(refused ? 'running' : 'failed');
      }
    })();
    pending.current = run;
    void run.finally(() => {
      if (pending.current === run) pending.current = null;
    });
  }, []);

  // `snapshot` is a trigger only: the next input enters again after `running` or `failed`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    // A conflict stays until the modal is closed: only a discard and a reopen resolve it.
    if (!dirty) setProblem((current) => (current === 'conflict' ? current : null));
    else attempt();
  }, [dirty, snapshot, readOnly, draftAtOpen, attempt]);

  const retry = useCallback(() => {
    const now = view.current;
    if (now.problem === 'running' || now.problem === 'failed') attempt();
  }, [attempt]);

  const release = useCallback(async () => {
    if (pending.current !== null) await pending.current;
    if (!enteredRef.current) return;
    await latest.current.leave();
    enteredRef.current = false;
    setEntered(false);
  }, []);

  const locked = draftAtOpen || entered;
  const canSave = dirty && !readOnly && problem === null && locked;
  return { entered, problem, canSave, release, retry };
}
