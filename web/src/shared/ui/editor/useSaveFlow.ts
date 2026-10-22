import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WriteError } from '../../api/writeErrors';

/**
 * Runs a save once at a time. While it runs the dialog cannot be closed; when it fails the input
 * stays and `error` says why; when it succeeds the dialog closes, unless `closeOnSuccess` is false
 * (a surface that keeps editing after a save).
 */
export function useSaveFlow({
  onClose,
  onSavingChange,
  closeOnSuccess = true,
}: {
  onClose: () => void;
  closeOnSuccess?: boolean;
  onSavingChange?: (saving: boolean) => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set synchronously so a second submit or close in the same tick is refused.
  const busy = useRef(false);

  const run = useCallback(
    async (save: () => Promise<void>) => {
      if (busy.current) return;
      busy.current = true;
      setSaving(true);
      setError(null);
      onSavingChange?.(true);
      try {
        await save();
        busy.current = false;
        if (closeOnSuccess) onClose();
        else onSavingChange?.(false);
      } catch (cause) {
        busy.current = false;
        onSavingChange?.(false);
        // The server's reason is not shown: a known code has its own sentence, any other failure
        // gets the design's sentence, and the input stays in both cases.
        setError(
          cause instanceof WriteError && cause.code === 'task_not_draft'
            ? t('editor.notDraft')
            : t('editor.saveFailed'),
        );
      } finally {
        setSaving(false);
      }
    },
    [onClose, onSavingChange, closeOnSuccess, t],
  );

  return { saving, error, busy, run };
}
