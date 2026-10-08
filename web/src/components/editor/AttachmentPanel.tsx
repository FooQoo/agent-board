import {
  ImageIcon,
  ImageOffIcon,
  Maximize2Icon,
  PaperclipIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorAttachment } from './attachmentTypes';
import { formatAttachmentSize } from './attachmentTypes';
import '../../styles/editor.css';

export interface AttachmentPanelProps {
  attachments: readonly EditorAttachment[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onInsert?: (attachment: EditorAttachment) => void;
  disabled?: boolean;
  className?: string;
}

/** The compact attachment tray used by the editor. The editor owns persistence and saving. */
export function AttachmentPanel({
  attachments,
  onFiles,
  onRemove,
  onInsert,
  disabled = false,
  className = '',
}: AttachmentPanelProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState<EditorAttachment | null>(null);

  const acceptFiles = (files: FileList | File[]) => {
    onFiles(Array.from(files).filter((file) => file.type.startsWith('image/')));
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) acceptFiles(event.dataTransfer.files);
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      acceptFiles(files);
    }
  };

  return (
    <section
      className={`editor-attachments ${className}`}
      aria-label={t('editor.attachmentsLabel')}
      onPaste={onPaste}
    >
      <div className="editor-attachments__header">
        <span className="editor-attachments__title">
          <PaperclipIcon aria-hidden="true" />
          {t('editor.attachments')}
        </span>
        <span className="editor-attachments__count">{attachments.length}</span>
        <button
          type="button"
          className="editor-attachments__add"
          aria-label={t('editor.addAttachment')}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <ImageIcon aria-hidden="true" />
        </button>
        <input
          ref={input}
          className="editor-attachments__input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          disabled={disabled}
          onChange={(event) => {
            if (event.currentTarget.files) acceptFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
      </div>
      <div
        className={`editor-attachments__dropzone${dragging ? ' editor-attachments__dropzone--active' : ''}`}
        role="region"
        aria-label={t('editor.attachmentsDropHint')}
        data-empty={attachments.length === 0 ? 'true' : undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {attachments.length === 0 ? (
          <button
            type="button"
            className="editor-attachments__empty"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <ImageOffIcon aria-hidden="true" />
            <span>{t('editor.attachmentsEmpty')}</span>
            <small>{t('editor.attachmentsDropHint')}</small>
          </button>
        ) : (
          <div className="editor-attachments__list">
            {attachments.map((attachment) => (
              <AttachmentTile
                key={attachment.id}
                attachment={attachment}
                disabled={disabled}
                onRemove={() => onRemove(attachment.id)}
                onInsert={onInsert ? () => onInsert(attachment) : undefined}
                onZoom={() => setZoom(attachment)}
              />
            ))}
          </div>
        )}
      </div>
      {zoom !== null && (
        <div className="editor-attachments__lightbox" role="dialog" aria-label={zoom.name}>
          <button
            type="button"
            className="editor-attachments__lightbox-close"
            aria-label={t('dialog.close')}
            onClick={() => setZoom(null)}
          >
            <XIcon aria-hidden="true" />
          </button>
          <img src={zoom.url} alt={zoom.name} />
        </div>
      )}
    </section>
  );
}

function AttachmentTile({
  attachment,
  disabled,
  onRemove,
  onInsert,
  onZoom,
}: {
  attachment: EditorAttachment;
  disabled: boolean;
  onRemove: () => void;
  onInsert?: () => void;
  onZoom: () => void;
}) {
  const { t } = useTranslation();
  return (
    <article className="editor-attachments__tile">
      <button
        type="button"
        className="editor-attachments__preview"
        aria-label={t('editor.previewAttachment', { name: attachment.name })}
        onClick={onZoom}
      >
        <img src={attachment.url} alt="" />
        <Maximize2Icon aria-hidden="true" />
      </button>
      <div className="editor-attachments__meta">
        <span className="editor-attachments__name" title={attachment.name}>
          {attachment.name}
        </span>
        <span className="editor-attachments__size">{formatAttachmentSize(attachment.size)}</span>
      </div>
      <div className="editor-attachments__actions">
        {onInsert && (
          <button
            type="button"
            className="editor-attachments__insert"
            disabled={disabled}
            onClick={onInsert}
          >
            {t('editor.insertAttachment')}
          </button>
        )}
        <button
          type="button"
          className="editor-attachments__remove"
          aria-label={t('editor.removeAttachment', { name: attachment.name })}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2Icon aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

export function AttachmentDropHint({ children }: { children?: ReactNode }) {
  return <span className="editor-attachments__drop-hint">{children}</span>;
}
