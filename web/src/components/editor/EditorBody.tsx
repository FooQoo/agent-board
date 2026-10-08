import { CircleAlertIcon, InfoIcon } from 'lucide-react';
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownView } from '../markdown/MarkdownView';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { AttachmentPanel } from './AttachmentPanel';
import type { EditorAttachment } from './attachmentTypes';
import { DESCRIPTION_LIMIT, TITLE_LIMIT, countChars } from './limits';
import { activeOutlineIndex, outlineOf } from './outline';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import '../../styles/editor.css';

type Tab = 'edit' | 'preview';

export interface EditorBodyProps {
  title: string;
  onTitleChange: (title: string) => void;
  titlePlaceholder?: string;
  titleInvalid?: boolean;
  description: string;
  onDescriptionChange: (description: string) => void;
  /** The text is being saved: nothing can be edited. */
  disabled: boolean;
  /** A field placed between the title and the description (the assignee of a new card). */
  extraField?: ReactNode;
  attachments?: readonly EditorAttachment[];
  onFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onInsertAttachment?: (attachment: EditorAttachment) => void;
}

/** The body shared by the edit and the add dialog: outline, title, description editor and preview. */
export function EditorBody({
  title,
  onTitleChange,
  titlePlaceholder,
  titleInvalid,
  description,
  onDescriptionChange,
  disabled,
  extraField,
  attachments = [],
  onFiles,
  onRemoveAttachment,
  onInsertAttachment,
}: EditorBodyProps) {
  const { t } = useTranslation();
  const ids = useId();
  const titleId = `${ids}-title`;
  const labelId = `${ids}-label`;
  const [tab, setTab] = useState<Tab>('edit');
  const [cursor, setCursor] = useState(0);
  const editor = useRef<MarkdownEditorHandle>(null);
  const pendingJump = useRef<number | null>(null);

  const deferred = useDeferredValue(description);
  const outline = useMemo(() => outlineOf(deferred), [deferred]);
  const active = activeOutlineIndex(outline, cursor);

  const count = countChars(description);
  const over = count - DESCRIPTION_LIMIT;
  const overLimit = over > 0;

  // The editor stays mounted (hidden) in the preview, so the cursor and the undo history survive.
  useEffect(() => {
    if (tab === 'edit' && pendingJump.current !== null) {
      editor.current?.goTo(pendingJump.current);
      pendingJump.current = null;
    }
  }, [tab]);

  const jumpTo = (position: number) => {
    pendingJump.current = position;
    if (tab === 'edit') {
      editor.current?.goTo(position);
      pendingJump.current = null;
    } else {
      setTab('edit');
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'edit', label: t('editor.tabEdit') },
    { id: 'preview', label: t('editor.tabPreview') },
  ];
  const onTabKey = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`${ids}-tab-${next.id}`)?.focus();
  };

  return (
    <div className="editor__body">
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
              onClick={() => jumpTo(item.from)}
            >
              {item.text}
            </button>
          ))
        )}
      </nav>
      <div className="editor__main">
        <div className="editor__field">
          <Label htmlFor={titleId} className="editor__label">
            {t('editor.titleLabel')}
          </Label>
          <Input
            id={titleId}
            className="editor__input"
            value={title}
            maxLength={TITLE_LIMIT}
            placeholder={titlePlaceholder}
            disabled={disabled}
            aria-invalid={titleInvalid ? true : undefined}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </div>
        {extraField}
        <div className="editor__label-row">
          <span className="editor__label" id={labelId}>
            {t('editor.descriptionLabel')}
          </span>
          <span className="editor__counter" data-over={overLimit ? 'true' : undefined}>
            {t('editor.counter', {
              count: count.toLocaleString('en-US'),
              max: DESCRIPTION_LIMIT.toLocaleString('en-US'),
            })}
          </span>
        </div>
        <div className="editor__box" data-over={overLimit ? 'true' : undefined}>
          <div className="editor__tabs" role="tablist" aria-label={t('editor.modes')}>
            {tabs.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`${ids}-tab-${entry.id}`}
                className="editor__tab"
                aria-selected={tab === entry.id}
                aria-controls={`${ids}-panel-${entry.id}`}
                tabIndex={tab === entry.id ? 0 : -1}
                onClick={() => setTab(entry.id)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${ids}-panel-edit`}
            aria-labelledby={`${ids}-tab-edit`}
            className="editor__panel"
            hidden={tab !== 'edit'}
          >
            <MarkdownEditor
              ref={editor}
              value={description}
              onChange={onDescriptionChange}
              onCursorChange={setCursor}
              placeholder={t('editor.descriptionPlaceholder')}
              aria-label={t('editor.descriptionLabel')}
              disabled={disabled}
            />
          </div>
          <div
            role="tabpanel"
            id={`${ids}-panel-preview`}
            aria-labelledby={`${ids}-tab-preview`}
            className="editor__panel editor__preview"
            hidden={tab !== 'preview'}
          >
            {tab === 'preview' && <PreviewBody source={description} />}
          </div>
        </div>
        {onFiles && onRemoveAttachment && (
          <AttachmentPanel
            attachments={attachments}
            onFiles={onFiles}
            onRemove={onRemoveAttachment}
            onInsert={(a) => {
              editor.current?.insert(`![${a.name}](${a.url})`);
              onInsertAttachment?.(a);
            }}
            disabled={disabled}
          />
        )}
        <p className="editor__hint" data-over={overLimit ? 'true' : undefined}>
          {overLimit ? (
            <>
              <CircleAlertIcon aria-hidden="true" />
              <span role="status">
                {t('editor.overLimit', {
                  count: over,
                  max: DESCRIPTION_LIMIT.toLocaleString('en-US'),
                  over: over.toLocaleString('en-US'),
                })}
              </span>
            </>
          ) : (
            <>
              <InfoIcon aria-hidden="true" />
              <span>{t('editor.hint')}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function PreviewBody({ source }: { source: string }) {
  const { t } = useTranslation();
  if (source.trim() === '') return <p className="md-empty">{t('detail.noDescription')}</p>;
  return <MarkdownView source={source} variant="wide" />;
}
