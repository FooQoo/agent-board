import { BotIcon, UserRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMultipartRequest } from './editor/useMultipartRequest';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Label } from '@/components/ui/label';
import { RadioGroup } from '@/components/ui/radio-group';
import type { AcceptanceItem, Assignee } from '../types';
import { AcceptanceEditor } from './acceptance/AcceptanceEditor';
import { acceptanceProblem, composeNewText } from '../lib/acceptance';
import { Checkbox } from './ui/checkbox';
import { EditorBody, useOverLimit } from './editor/EditorBody';
import { EditorShell } from './editor/EditorShell';
import { DESCRIPTION_LIMIT, countChars, normalizeNewlines, titleProblem } from './editor/limits';
import type { RichMarkdownEditorHandle } from './editor/RichMarkdownEditor';
import { useSaveFlow } from './editor/useSaveFlow';
import { useAttachmentState } from './editor/useAttachmentState';
import type { EditorAttachment } from './editor/attachmentTypes';

export interface CreateInput {
  title: string;
  description: string;
  assignee: Assignee;
  /** The card becomes a draft right after it is added. */
  isDraft?: boolean;
  requestId?: string;
  attachments?: EditorAttachment[];
}

/** The dialog that adds a card: title, assignee (AI by default), a Markdown description and a draft box. */
export function CreateDialog({
  onClose,
  onSavingChange,
  onSubmit,
  projectId: _projectId,
}: {
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: CreateInput) => Promise<void>;
  projectId?: string;
}) {
  const { t } = useTranslation();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [conditions, setConditions] = useState<AcceptanceItem[]>([]);
  const [assignee, setAssignee] = useState<Assignee>('ai');
  const [isDraft, setIsDraft] = useState(false);
  const assigneeId = useId();
  const draftId = useId();
  const flow = useSaveFlow({ onClose, onSavingChange });
  const requestId = useMultipartRequest();
  const attachmentState = useAttachmentState({ resolveStoredUrl: () => '' });

  const body = () => normalizeNewlines(editor.current?.markdown() ?? description);
  // Typed input counts as unsaved: closing asks first, as in the edit dialog.
  const dirty =
    title.trim() !== '' ||
    description !== '' ||
    conditions.length > 0 ||
    attachmentState.attachments.length > 0;
  const overLimit = useOverLimit(description);
  const valid =
    titleProblem(title) === null &&
    countChars(description) <= DESCRIPTION_LIMIT &&
    acceptanceProblem(conditions) === null;
  const add = () => {
    if (!valid || flow.busy.current) return;
    // The conditions are written into the frontmatter of the new file, before the body.
    const text = composeNewText(body(), conditions);
    void flow.run(() =>
      onSubmit({
        ...(attachmentState.attachments.length
          ? {
              requestId: requestId({
                title: title.trim(),
                description: text,
                assignee,
                attachments: attachmentState.attachments.map((a) => a.id),
              }),
            }
          : {}),
        title: title.trim(),
        description: text,
        assignee,
        ...(isDraft ? { isDraft: true } : {}),
        ...(attachmentState.attachments.length ? { attachments: attachmentState.attachments } : {}),
      }),
    );
  };

  return (
    <EditorShell
      title={t('editor.addCardTitle')}
      badge={t('editor.draft')}
      variant="create"
      dirty={dirty}
      saving={flow.saving}
      error={flow.error}
      onRetry={add}
      overLimit={overLimit}
      onClose={onClose}
      status={dirty ? t('editor.unsaved') : t('editor.noChanges')}
      footerStart={
        <div className="editor__draft">
          <Checkbox
            id={draftId}
            checked={isDraft}
            aria-label={t('editor.draft')}
            disabled={flow.saving}
            onCheckedChange={(checked) => setIsDraft(checked === true)}
          />
          <Label htmlFor={draftId}>{t('editor.draft')}</Label>
        </div>
      }
      actions={
        <Button type="button" disabled={flow.saving || !valid} onClick={add}>
          {flow.saving ? t('dialog.saving') : t('editor.add')}
        </Button>
      }
    >
      <EditorBody
        title={title}
        onTitleChange={setTitle}
        titlePlaceholder={t('editor.titlePlaceholder')}
        description={description}
        onDescriptionChange={setDescription}
        editorRef={editor}
        disabled={flow.saving}
        attachmentNotice={attachmentState.error}
        attachments={attachmentState.attachments}
        onFiles={attachmentState.addFiles}
        onRemoveAttachment={attachmentState.remove}
        extraField={
          <>
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
                  <RadioGroupPrimitive.Item
                    key={value}
                    value={value}
                    className="editor__segment"
                    aria-label={t(value === 'ai' ? 'editor.assigneeAi' : 'editor.assigneeUser')}
                    title={t(value === 'ai' ? 'editor.assigneeAi' : 'editor.assigneeUser')}
                  >
                    {value === 'ai' ? (
                      <BotIcon aria-hidden="true" />
                    ) : (
                      <UserRoundIcon aria-hidden="true" />
                    )}
                    <span>{t(value === 'ai' ? 'editor.assigneeAi' : 'editor.assigneeUser')}</span>
                  </RadioGroupPrimitive.Item>
                ))}
              </RadioGroup>
            </div>
            <AcceptanceEditor items={conditions} onChange={setConditions} disabled={flow.saving} />
          </>
        }
      />
    </EditorShell>
  );
}
