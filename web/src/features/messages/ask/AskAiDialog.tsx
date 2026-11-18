import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import {
  RichMarkdownEditor,
  type RichMarkdownEditorHandle,
} from '../../../shared/rich-editor/RichMarkdownEditor';
import { DialogFrame } from '../../../shared/ui/dialog-frame/DialogFrame';
import { AttachmentPanel } from '../../../shared/ui/editor/AttachmentPanel';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';
import { useAttachmentState } from '../../../shared/ui/editor/useAttachmentState';
import { Surface } from '../../../shared/ui/surface/Surface';
import '../../../shared/styles/rich-table.css';
import '../../../shared/styles/rich-body.css';
import '../../../shared/styles/editor.css';
import '../../../shared/styles/modal.css';
import './ask-ai.css';
import { REQUEST_LIMIT } from './sendRequest';

/** What the dialog hands over: the Markdown text and the images the person added. */
export interface AskAiInput {
  text: string;
  attachments: EditorAttachment[];
}

/**
 * The "Ask AI" dialog: one Markdown text in the rich editor the task dialogs use, and images. It has
 * no epic selector and no manual creation, because a request is linked to neither tasks nor epics.
 * It is a modal on the board and a bottom sheet on a phone.
 */
export function AskAiDialog({
  kind = 'dialog',
  onClose,
  onSubmit,
  onSavingChange,
  initialText = '',
}: {
  /** A modal on the board, a bottom sheet on a phone. */
  kind?: 'dialog' | 'sheet';
  onClose: () => void;
  /** Sends the request. A rejection keeps the dialog open and shows its message. */
  onSubmit: (input: AskAiInput) => Promise<void>;
  /** Reports that a send started (`true`) or failed and the input was kept (`false`). */
  onSavingChange?: (saving: boolean) => void;
  initialText?: string;
}) {
  const { t } = useTranslation();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const images = useAttachmentState({ resolveStoredUrl: () => '' });
  const insertImage = (attachment: EditorAttachment) => {
    const alt = attachment.name.replace(/[\\[\]!*_`]/g, '\\$&');
    editor.current?.insert(`\n\n![${alt}](attachment:${attachment.id})\n\n`);
  };
  const addImages = (files: File[]) => {
    // The demo build keeps nothing it could save pictures to.
    if (import.meta.env.MODE === 'demo') return;
    const pictures = files.filter((file) => file.type.startsWith('image/'));
    if (pictures.length > 0) images.addFiles(pictures);
  };
  const validate = (): string | null => {
    if (text.trim() === '') return t('askAi.required');
    if ([...text.trim()].length > REQUEST_LIMIT) return t('askAi.tooLong', { max: REQUEST_LIMIT });
    return null;
  };
  const send = async () => {
    try {
      await onSubmit({ text: text.trim(), attachments: images.attachments });
    } catch (cause) {
      // Keep the server's reason visible so a refused request can be fixed; a network failure
      // gets the localized message.
      const message = cause instanceof Error ? cause.message : '';
      throw new Error(message || t('askAi.sendFailed'));
    }
  };
  const submitSheet = async () => {
    const invalid = validate();
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    setError('');
    setSaving(true);
    onSavingChange?.(true);
    try {
      await send();
    } catch (cause) {
      onSavingChange?.(false);
      setError(cause instanceof Error ? cause.message : t('askAi.sendFailed'));
    } finally {
      setSaving(false);
    }
  };
  const fields = (
    <div
      role="region"
      aria-label={t('askAi.title')}
      className="ask-ai__field"
      onPasteCapture={(event) => {
        const files = Array.from(event.clipboardData.files);
        if (!files.some((file) => file.type.startsWith('image/'))) return;
        event.preventDefault();
        event.stopPropagation();
        addImages(files);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        addImages(Array.from(event.dataTransfer.files));
      }}
    >
      <span className="ask-ai__label">{t('askAi.prompt')}</span>
      <div
        className="editor__box ask-ai__box"
        onPointerDown={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest('.ProseMirror, button, a')) return;
          editor.current?.focus();
        }}
      >
        <RichMarkdownEditor
          ref={editor}
          value={text}
          onChange={setText}
          aria-label={t('askAi.prompt')}
          placeholder={t('askAi.placeholder')}
          resolveAttachment={(id) => images.attachments.find((item) => item.id === id)?.url ?? null}
        />
      </div>
      {/* The demo build keeps nothing it could save pictures to. */}
      {import.meta.env.MODE === 'demo' ? null : (
        <AttachmentPanel
          attachments={images.attachments}
          onFiles={addImages}
          onRemove={images.remove}
          onInsert={insertImage}
          notice={images.error}
          disabled={saving}
          className="request-dialog__attachments ask-ai__images"
          optionalHeader
          layout="tray"
        />
      )}
    </div>
  );
  if (kind === 'sheet') {
    return (
      <Surface
        kind="sheet"
        title={t('askAi.title')}
        closeLabel={t('dialog.close')}
        onClose={onClose}
        footer={
          <>
            {error && (
              <p className="ask-ai__error" role="alert">
                {error}
              </p>
            )}
            {/* The close button in the header cancels; the footer keeps the one thing to do. */}
            <Button
              type="button"
              className="ask-ai__submit"
              disabled={saving}
              onClick={() => void submitSheet()}
            >
              {t('askAi.submit')}
            </Button>
          </>
        }
      >
        <div className="ask-ai ask-ai--sheet">
          {fields}
          <p className="ask-ai__note">{t('askAi.note')}</p>
        </div>
      </Surface>
    );
  }
  return (
    <DialogFrame
      title={t('askAi.title')}
      submitLabel={t('askAi.submit')}
      onClose={onClose}
      dirty={text.trim() !== '' || images.attachments.length > 0}
      onSavingChange={onSavingChange}
      validate={validate}
      save={send}
      footerNote={<p className="ask-ai__note">{t('askAi.note')}</p>}
      scrollBody
      className="request-dialog ask-ai"
    >
      {fields}
    </DialogFrame>
  );
}
