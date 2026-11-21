import { useRef, useState } from 'react';
import type { ProjectId } from '../../../shared/api/contracts';
import { setDraft } from '../api/edit';

/** Ends a person's draft of a card (the edit lock), one request at a time; a failure is kept to show. */
export function useFinalizeDraft(projectId: ProjectId, taskId: number, onChanged?: () => void) {
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  const busy = useRef(false);
  const finalizeDraft = async () => {
    if (busy.current) return;
    busy.current = true;
    setDraftSaving(true);
    setDraftFailed(false);
    try {
      await setDraft(projectId, taskId, null);
      onChanged?.();
    } catch {
      setDraftFailed(true);
    } finally {
      busy.current = false;
      setDraftSaving(false);
    }
  };
  return { draftSaving, draftFailed, finalizeDraft };
}
