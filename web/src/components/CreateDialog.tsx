import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Label } from '@/components/ui/label';
import { RadioGroup } from '@/components/ui/radio-group';
import type { Assignee } from '../types';
import { EditorBody } from './editor/EditorBody';
import { EditorShell } from './editor/EditorShell';
import { DESCRIPTION_LIMIT, countChars, normalizeNewlines, titleProblem } from './editor/limits';
import { useSaveFlow } from './editor/useSaveFlow';

export interface CreateInput {
  title: string;
  description: string;
  assignee: Assignee;
}

/** The dialog that adds a card: title, assignee (AI by default) and a Markdown description. */
export function CreateDialog({
  onClose,
  onSavingChange,
  onSubmit,
}: {
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: CreateInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState<Assignee>('ai');
  const assigneeId = useId();
  const flow = useSaveFlow({ onClose, onSavingChange });

  const valid = titleProblem(title) === null && countChars(description) <= DESCRIPTION_LIMIT;
  const add = () => {
    if (!valid || flow.busy.current) return;
    void flow.run(() =>
      onSubmit({ title: title.trim(), description: normalizeNewlines(description), assignee }),
    );
  };

  return (
    <EditorShell
      title={t('editor.addCardTitle')}
      badge={t('editor.newBadge')}
      variant="create"
      dirty={false}
      saving={flow.saving}
      error={flow.error}
      onRetry={add}
      onClose={onClose}
      actions={
        <button
          type="button"
          className="editor__btn editor__btn--primary"
          disabled={flow.saving || !valid}
          onClick={add}
        >
          {flow.saving ? t('dialog.saving') : t('editor.add')}
        </button>
      }
    >
      <EditorBody
        title={title}
        onTitleChange={setTitle}
        titlePlaceholder={t('editor.titlePlaceholder')}
        description={description}
        onDescriptionChange={setDescription}
        disabled={flow.saving}
        extraField={
          <div className="editor__field">
            <Label id={assigneeId} className="editor__label">
              {t('editor.assigneeLabel')}
            </Label>
            <RadioGroup
              className="editor__segments"
              aria-labelledby={assigneeId}
              value={assignee}
              disabled={flow.saving}
              onValueChange={(value) => setAssignee(value === 'human' ? 'human' : 'ai')}
            >
              {(['ai', 'human'] as const).map((value) => (
                <RadioGroupPrimitive.Item key={value} value={value} className="editor__segment">
                  {t(value === 'ai' ? 'editor.assigneeAi' : 'editor.assigneeUser')}
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroup>
          </div>
        }
      />
    </EditorShell>
  );
}
