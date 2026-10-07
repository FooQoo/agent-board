import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActionDialogData } from '../ActionDialog';
import type { Card } from '../../types';
import { EditorBody } from './EditorBody';
import { EditorShell } from './EditorShell';
import { DESCRIPTION_LIMIT, countChars, normalizeNewlines, titleProblem } from './limits';
import { useSaveFlow } from './useSaveFlow';

/** The dialog that edits the title and description of a draft; it saves, or saves and finalizes. */
export function EditDialog({
  card,
  onClose,
  onSavingChange,
  onSubmit,
}: {
  card: Card;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: ActionDialogData) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [initialDescription] = useState(() => normalizeNewlines(card.description));
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(initialDescription);
  const [lastFinalize, setLastFinalize] = useState(false);
  const flow = useSaveFlow({ onClose, onSavingChange });

  const titleChanged = title.trim() !== card.title;
  const descriptionChanged = description !== initialDescription;
  const dirty = titleChanged || descriptionChanged;
  const valid = titleProblem(title) === null && countChars(description) <= DESCRIPTION_LIMIT;

  const save = (finalize: boolean) => {
    if (!valid || flow.busy.current) return;
    setLastFinalize(finalize);
    void flow.run(() =>
      onSubmit({
        ...(titleChanged ? { title: title.trim() } : {}),
        ...(descriptionChanged ? { description } : {}),
        ...(finalize ? { finalize: true } : {}),
      }),
    );
  };

  const failed = flow.error !== null;
  return (
    <EditorShell
      cardId={card.id}
      title={card.title}
      badge={t('editor.editingDraft')}
      variant="edit"
      dirty={dirty}
      saving={flow.saving}
      error={flow.error}
      onRetry={() => save(lastFinalize)}
      onClose={onClose}
      status={dirty ? t('editor.unsaved') : undefined}
      actions={
        <>
          <button
            type="button"
            className="editor__btn editor__btn--secondary"
            disabled={flow.saving || !valid || !dirty}
            onClick={() => save(false)}
          >
            {flow.saving && !lastFinalize
              ? t('dialog.saving')
              : failed
                ? t('editor.retrySave')
                : t('editor.save')}
          </button>
          <button
            type="button"
            className="editor__btn editor__btn--primary"
            disabled={flow.saving || !valid}
            onClick={() => save(true)}
          >
            {flow.saving && lastFinalize ? t('dialog.saving') : t('editor.saveAndFinalize')}
          </button>
        </>
      }
    >
      <EditorBody
        title={title}
        onTitleChange={setTitle}
        titleInvalid={titleProblem(title) !== null}
        description={description}
        onDescriptionChange={setDescription}
        disabled={flow.saving}
      />
    </EditorShell>
  );
}
