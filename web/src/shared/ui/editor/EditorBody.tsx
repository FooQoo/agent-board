import { useDeferredValue, useId, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { AttachmentPanel } from './AttachmentPanel';
import { CollapsibleSection } from './CollapsibleSection';
import type { AttachmentNotice } from './useAttachmentState';
import type { EditorAttachment } from './attachmentTypes';
import { DESCRIPTION_LIMIT, TITLE_LIMIT, countChars } from './limits';
import { activeOutlineIndex, outlineOf } from '../../rich-editor/outline';
import {
  RichMarkdownEditor,
  type RichMarkdownEditorHandle,
} from '../../rich-editor/RichMarkdownEditor';
import { Input } from '@/shared/ui/input';
import { PaperclipIcon } from 'lucide-react';
import { Label } from '@/shared/ui/label';
import '../../styles/editor.css';

export interface EditorBodyProps {
  title: string;
  onTitleChange: (title: string) => void;
  /** The label of the title field; the epic dialog calls its formal name a name. */
  titleLabel?: string;
  titlePlaceholder?: string;
  titleInvalid?: boolean;
  /** The Markdown body: a card's description or an epic's details. */
  description: string;
  onDescriptionChange: (description: string) => void;
  /** The accessible name of the body. */
  bodyLabel?: string;
  /** The longest body the dialog accepts; a card's description unless the dialog says otherwise. */
  limit?: number;
  /** The handle of the rich editor: the dialog reads the text and inserts images through it. */
  editorRef: RefObject<RichMarkdownEditorHandle | null>;
  /** The text is being saved: nothing can be edited. */
  disabled: boolean;
  /** Shown above the title (the EPIC-ID label of a card, the label row of an epic). */
  beforeTitle?: ReactNode;
  /** Shown at the top of the right column, above the images panel (the epic row of a card). */
  asideTop?: ReactNode;
  /** Fields that scroll with the body, such as acceptance conditions. */
  extraField?: ReactNode;
  /** Shown in the right column above the images (the progress table of an epic). */
  sidebar?: ReactNode;
  /** Shown under the body, outside its scroll: the completion conditions. */
  dock?: ReactNode;
  /** When set, the images panel folds; the dialog says whether it is open. */
  attachmentsOpen?: boolean;
  onAttachmentsOpenChange?: (open: boolean) => void;
  attachments?: readonly EditorAttachment[];
  /** Why the last picture was refused; the side panel shows it. */
  attachmentNotice?: AttachmentNotice | null;
  onFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
}

/**
 * The over-limit band the dialog shows above its footer, or null while the text fits. The band says
 * how many characters to remove; the counter next to the body shows the same count in red.
 */
export function useOverLimit(
  description: string,
  limit: number = DESCRIPTION_LIMIT,
): { message: string; count: string } | null {
  const { t } = useTranslation();
  const count = countChars(description);
  const over = count - limit;
  if (over <= 0) return null;
  return {
    message: t('editor.overLimit', {
      count: over,
      max: limit.toLocaleString('en-US'),
      over: over.toLocaleString('en-US'),
    }),
    count: `${count.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}`,
  };
}

/** The body shared by the edit and the add dialogs: outline, title, the rich editor and the images. */
export function EditorBody({
  title,
  onTitleChange,
  titleLabel,
  titlePlaceholder,
  titleInvalid,
  description,
  onDescriptionChange,
  bodyLabel,
  limit = DESCRIPTION_LIMIT,
  editorRef,
  disabled,
  beforeTitle,
  asideTop,
  extraField,
  sidebar,
  dock,
  attachmentsOpen,
  onAttachmentsOpenChange,
  attachments = [],
  attachmentNotice = null,
  onFiles,
  onRemoveAttachment,
}: EditorBodyProps) {
  const { t } = useTranslation();
  const ids = useId();
  const titleId = `${ids}-title`;
  const [cursor, setCursor] = useState(0);

  const deferred = useDeferredValue(description);
  const outline = useMemo(() => outlineOf(deferred), [deferred]);
  // Before the first chapter the first one is the current one, as the design shows at the start.
  const active = outline.length > 0 ? Math.max(activeOutlineIndex(outline, cursor), 0) : -1;

  const count = countChars(description);
  const over = count - limit;
  const overLimit = over > 0;
  const body = bodyLabel ?? t('editor.descriptionLabel');

  const insertImage = (attachment: EditorAttachment) => {
    const alt = attachment.name.replace(/[\\[\]!*_`]/g, '\\$&').replace(/[\r\n]/g, ' ');
    editorRef.current?.insert(`\n\n![${alt}](attachment:${attachment.id})\n\n`);
  };

  return (
    <div
      role="region"
      aria-label={body}
      className="editor__body"
      onPasteCapture={(event) => {
        if (disabled || !onFiles) return;
        const files = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        onFiles(files);
      }}
      onDragOver={(event) => {
        if (!disabled && onFiles && event.dataTransfer.types.includes('Files'))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (disabled || !onFiles) return;
        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) return;
        event.preventDefault();
        onFiles(files);
      }}
    >
      <div className="editor__side">
        <nav className="editor__outline" aria-label={t('editor.outlineName')}>
          <p className="editor__outline-label">{t('editor.outlineLabel')}</p>
          {outline.length === 0 ? (
            <p className="editor__outline-empty">{t('editor.outlineEmpty')}</p>
          ) : (
            outline.map((item, index) => (
              <button
                key={`${item.from}:${item.text}`}
                type="button"
                className="editor__outline-item"
                aria-current={index === active ? 'location' : undefined}
                title={item.text}
                disabled={disabled}
                onClick={() => editorRef.current?.goTo(index)}
              >
                <span className="editor__outline-no" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {item.text}
              </button>
            ))
          )}
        </nav>
      </div>
      <div className="editor__main">
        {beforeTitle}
        <div className="editor__field">
          <Label htmlFor={titleId} className="editor__label">
            {titleLabel ?? t('editor.titleLabel')}
          </Label>
          <Input
            id={titleId}
            className="editor__input editor__input--title"
            value={title}
            maxLength={TITLE_LIMIT}
            placeholder={titlePlaceholder}
            disabled={disabled}
            aria-invalid={titleInvalid ? true : undefined}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </div>
        <div className="editor__document">
          {extraField}
          <div className="editor__label-row">
            <span className="editor__label">{body}</span>
            <span className="editor__counter" data-over={overLimit ? 'true' : undefined}>
              {t('editor.counter', {
                count: count.toLocaleString('en-US'),
                max: limit.toLocaleString('en-US'),
              })}
            </span>
          </div>
          <div
            className="editor__box"
            data-over={overLimit ? 'true' : undefined}
            onPointerDown={(event) => {
              const target = event.target;
              if (!(target instanceof Element)) return;
              if (
                target.closest('.ProseMirror, button, input, select, textarea, a, [role="button"]')
              ) {
                return;
              }
              editorRef.current?.focus();
            }}
          >
            <RichMarkdownEditor
              ref={editorRef}
              value={description}
              onChange={onDescriptionChange}
              onCursorChange={setCursor}
              aria-label={body}
              placeholder={t('editor.descriptionPlaceholder')}
              disabled={disabled}
              resolveAttachment={(id) =>
                attachments.find((attachment) => attachment.id === id)?.url ?? null
              }
            />
          </div>
        </div>
        {dock && <div className="editor__dock">{dock}</div>}
      </div>
      {onFiles && onRemoveAttachment && (
        <div className={sidebar ? 'editor__aside editor__aside--progress' : 'editor__aside'}>
          {asideTop}
          {sidebar}
          {onAttachmentsOpenChange ? (
            <CollapsibleSection
              title={t('editor.attachments')}
              icon={
                <PaperclipIcon aria-hidden="true" focusable="false" className="collapsible__icon" />
              }
              count={attachments.length}
              open={attachmentsOpen === true}
              onToggle={() => onAttachmentsOpenChange(attachmentsOpen !== true)}
            >
              <AttachmentPanel
                attachments={attachments}
                onFiles={onFiles}
                onRemove={onRemoveAttachment}
                onInsert={insertImage}
                notice={attachmentNotice}
                disabled={disabled}
                showHeader={false}
              />
            </CollapsibleSection>
          ) : (
            <AttachmentPanel
              attachments={attachments}
              onFiles={onFiles}
              onRemove={onRemoveAttachment}
              onInsert={insertImage}
              notice={attachmentNotice}
              disabled={disabled}
            />
          )}
        </div>
      )}
    </div>
  );
}
