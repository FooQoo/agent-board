import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiWriteError } from '../../api';

/**
 * Runs a save once at a time. While it runs the dialog cannot be closed; when it fails the input
 * stays and `error` says why; when it succeeds the dialog closes.
 */
export function useSaveFlow({
  onClose,
  onSavingChange,
}: {
  onClose: () => void;
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
        onClose();
      } catch (cause) {
        busy.current = false;
        onSavingChange?.(false);
        if (cause instanceof ApiWriteError) {
          setError(cause.code === 'card_not_draft' ? t('editor.notDraft') : cause.message);
        } else {
          setError(t('editor.saveFailed'));
        }
      } finally {
        setSaving(false);
      }
    },
    [onClose, onSavingChange, t],
  );

  return { saving, error, busy, run };
}
