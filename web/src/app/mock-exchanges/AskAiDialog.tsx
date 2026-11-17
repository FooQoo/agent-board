import { useRef, useState } from 'react';
import { Button } from '@/shared/ui/button';
import {
  RichMarkdownEditor,
  type RichMarkdownEditorHandle,
} from '../../shared/rich-editor/RichMarkdownEditor';
import { DialogFrame } from '../../shared/ui/dialog-frame/DialogFrame';
import { AttachmentPanel } from '../../shared/ui/editor/AttachmentPanel';
import type { EditorAttachment, StoredAttachment } from '../../shared/ui/editor/attachmentTypes';
import { useAttachmentState } from '../../shared/ui/editor/useAttachmentState';
import '../../shared/styles/rich-table.css';
import '../../shared/styles/rich-body.css';
import '../../shared/styles/editor.css';
import '../../shared/styles/modal.css';
import './exchanges-mock.css';
import { Surface } from './Surface';
import { useMockText } from './text';

/** The images a filled draft starts with; the first one is placed in the draft text. */
function draftImages(count: number): StoredAttachment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `a5a${String(index + 1).padStart(29, '0')}`,
    name: index === 0 ? 'login.png' : `screen-${index + 1}.png`,
    mediaType: 'image/png',
    size: 182_000,
  }));
}

/**
 * The "Ask AI" dialog: one Markdown text in the rich editor the task dialogs use, and images. It has
 * no epic selector and no manual creation, because a request is linked to neither tasks nor epics.
 */
export function AskAiDialog({
  kind = 'dialog',
  onClose,
  initialText = '',
  initialImages = 0,
}: {
  /** A modal on the board, a bottom sheet on a phone. */
  kind?: 'dialog' | 'sheet';
  onClose: () => void;
  initialText?: string;
  initialImages?: number;
}) {
  const m = useMockText();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState('');
  const images = useAttachmentState({
    initial: draftImages(initialImages),
    resolveStoredUrl: () => '/sample-attachment.png',
  });
  const insertImage = (attachment: EditorAttachment) => {
    const alt = attachment.name.replace(/[\\[\]!*_`]/g, '\\$&');
    editor.current?.insert(`\n\n![${alt}](attachment:${attachment.id})\n\n`);
  };
  const addImages = (files: File[]) => {
    const pictures = files.filter((file) => file.type.startsWith('image/'));
    if (pictures.length > 0) images.addFiles(pictures);
  };
  const fields = (
    <div
      role="region"
      aria-label={m.askTitle}
      className="xask__field"
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
      <span className="xask__label">{m.askPrompt}</span>
      <div
        className="editor__box xask__box"
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
          aria-label={m.askPrompt}
          placeholder={m.askPlaceholder}
          resolveAttachment={(id) => images.attachments.find((item) => item.id === id)?.url ?? null}
        />
      </div>
      <AttachmentPanel
        attachments={images.attachments}
        onFiles={addImages}
        onRemove={images.remove}
        onInsert={insertImage}
        notice={images.error}
        className="request-dialog__attachments xask__images"
        optionalHeader
        layout="tray"
      />
    </div>
  );
  if (kind === 'sheet') {
    return (
      <Surface
        kind="sheet"
        title={m.askTitle}
        onClose={onClose}
        className="xask-surface"
        footer={
          <>
            {error && (
              <p className="xask__error" role="alert">
                {error}
              </p>
            )}
            <p className="xask__note">{m.askNote}</p>
            <div className="xask__buttons">
              <Button type="button" variant="outline" onClick={onClose}>
                {m.cancel}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (text.trim() === '') setError(m.askRequired);
                  else onClose();
                }}
              >
                {m.askSubmit}
              </Button>
            </div>
          </>
        }
      >
        <div className="xask xask--sheet">{fields}</div>
      </Surface>
    );
  }
  return (
    <DialogFrame
      title={m.askTitle}
      submitLabel={m.askSubmit}
      onClose={onClose}
      dirty={text.trim() !== '' || images.attachments.length > 0}
      validate={() => (text.trim() === '' ? m.askRequired : null)}
      save={async () => {}}
      footerNote={<p className="xask__note">{m.askNote}</p>}
      scrollBody
      className="request-dialog xask"
    >
      {fields}
    </DialogFrame>
  );
}
