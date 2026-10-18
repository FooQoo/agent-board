import { PlusIcon, Maximize2Icon, PaperclipIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Lightbox } from '../Lightbox';
import type { EditorAttachment } from './attachmentTypes';
import { formatAttachmentSize } from './attachmentTypes';
import type { AttachmentNotice } from './useAttachmentState';
import '../../styles/editor.css';

export interface AttachmentPanelProps {
  id?: string;
  onClose?: () => void;
  attachments: readonly EditorAttachment[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onInsert?: (attachment: EditorAttachment) => void;
  /** Why the last picture was refused; shown above the list until the next change. */
  notice?: AttachmentNotice | null;
  disabled?: boolean;
  className?: string;
  showHeader?: boolean;
  /** Use the compact optional-attachment heading from the task request design. */
  optionalHeader?: boolean;
}

function noticeText(notice: AttachmentNotice, t: TFunction): string {
  switch (notice.kind) {
    case 'format':
      return t('editor.attachmentFormat', { name: notice.name });
    case 'tooLarge':
      return t('editor.attachmentTooLarge', { name: notice.name });
    case 'count':
      return t('editor.attachmentCount');
    case 'total':
      return t('editor.attachmentTotal');
  }
}

/** The compact attachment tray used by the editor. The editor owns persistence and saving. */
export function AttachmentPanel({
  id,
  onClose,
  attachments,
  onFiles,
  onRemove,
  onInsert,
  notice = null,
  disabled = false,
  className = '',
  showHeader = true,
  optionalHeader = false,
}: AttachmentPanelProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState<EditorAttachment | null>(null);
  const zoomTrigger = useRef<HTMLElement | null>(null);

  const acceptFiles = (files: FileList | File[]) => {
    onFiles(Array.from(files));
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
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
      id={id}
      className={`editor-attachments ${className}`}
      aria-label={t('editor.attachmentsLabel')}
      onPaste={onPaste}
    >
      {showHeader && (
        <div className="editor-attachments__header">
          <span className="editor-attachments__title">
            {!optionalHeader && <PaperclipIcon aria-hidden="true" />}
            {optionalHeader ? t('editor.attachmentsOptional') : t('editor.attachments')}
          </span>
          <span className="editor-attachments__count">
            {optionalHeader
              ? t('editor.attachmentsOptionalCount', { count: attachments.length })
              : attachments.length}
          </span>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="editor-attachments__close"
              aria-label={t('editor.closeAttachments')}
              onClick={onClose}
            >
              <XIcon aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className="editor-attachments__add"
        aria-label={t('editor.addAttachment')}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <PlusIcon aria-hidden="true" />
        {t('editor.addAttachment')}
      </Button>
      {notice && (
        <div className="editor-attachments__notice" role="alert">
          <strong>{t('editor.attachmentRefusedTitle')}</strong>
          <p className="editor-attachments__notice-text">{noticeText(notice, t)}</p>
        </div>
      )}
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
        {attachments.length > 0 && (
          <div className="editor-attachments__list">
            {attachments.map((attachment) => (
              <AttachmentTile
                key={attachment.id}
                attachment={attachment}
                disabled={disabled}
                onRemove={() => onRemove(attachment.id)}
                onInsert={onInsert ? () => onInsert(attachment) : undefined}
                onZoom={(trigger) => {
                  zoomTrigger.current = trigger;
                  setZoom(attachment);
                }}
              />
            ))}
          </div>
        )}
        {/* The one drop area, at the bottom of the panel: its guidance text opens the file picker. */}
        <Button
          type="button"
          variant="ghost"
          className="editor-attachments__drop"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {t('editor.attachmentsDropHint')}
        </Button>
      </div>
      {zoom !== null && (
        <Lightbox
          label={zoom.name}
          onClose={() => setZoom(null)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            zoomTrigger.current?.focus();
          }}
        >
          <img src={zoom.url} alt={zoom.name} />
        </Lightbox>
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
  onZoom: (trigger: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  return (
    <article className="editor-attachments__tile">
      <button
        type="button"
        className="editor-attachments__preview"
        aria-label={t('editor.previewAttachment', { name: attachment.name })}
        onClick={(event) => onZoom(event.currentTarget)}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="editor-attachments__insert"
            disabled={disabled}
            onClick={onInsert}
          >
            {t('editor.insertAttachment')}
          </Button>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="editor-attachments__remove"
        aria-label={t('editor.removeAttachment', { name: attachment.name })}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
    </article>
  );
}
