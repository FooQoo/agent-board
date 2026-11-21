import { useCallback, useRef } from 'react';
import type { ColumnName } from '../../shared/api/contracts';

/**
 * The move of one card between two lanes, as a person does it with a drag, a swipe tile, or an
 * action of the details. The card is in the target lane at once (`apply`), the server is asked once,
 * and a refusal puts the card back (`revert`) and says why in a notice (`notify`). Either way
 * `onDone` follows, so the screen reads the project again. A snapshot that arrives before the save
 * is answered keeps the card where the person put it, because `apply` stays on top of any read while
 * the save is in flight; once the server accepts it, `settle` lets the first newer read win, whatever
 * lane it shows (an agent may have moved the card on).
 * It serves the lane moves that need no confirmation; a Backlog card with an open question goes
 * through `useBacklogMove`, which shares this contract.
 */
export function useLaneMove({
  write,
  apply,
  settle,
  revert,
  onDone,
  notify,
  refusal,
}: {
  /** Saves the move. `from` is the status the screen showed, so a card that moved on is refused. */
  write: (id: number, to: ColumnName, from: ColumnName) => Promise<unknown>;
  apply: (id: number, to: ColumnName) => void;
  /** The write was accepted: only a read newer than the save may now replace the target lane. */
  settle: (id: number) => void;
  revert: (id: number) => void;
  onDone: () => void;
  notify: (message: string) => void;
  refusal: (cause: unknown) => string;
}) {
  // A card already on its way is not moved twice.
  const moving = useRef(new Set<number>());
  return useCallback(
    async (id: number, from: ColumnName, to: ColumnName) => {
      if (from === to || moving.current.has(id)) return;
      moving.current.add(id);
      apply(id, to);
      try {
        await write(id, to, from);
        settle(id);
      } catch (cause) {
        revert(id);
        notify(refusal(cause));
      } finally {
        moving.current.delete(id);
        onDone();
      }
    },
    [write, apply, settle, revert, onDone, notify, refusal],
  );
}
