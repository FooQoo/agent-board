import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../i18n';
import { useRichEditorSession, type SessionProps } from './useRichEditorSession';
import type { RichMarkdownEditorProps } from './richEditorTypes';
import '../markdown/markdown.css';
import './richMarkdown.css';

export { CODE_LANGUAGES } from './codeLanguages';
export { MermaidPreviews } from './MermaidPreviews';

/**
 * One editor, created from `text` once. A new session (a new key) is made only when the value
 * changes from outside.
 */
function EditorSession(props: SessionProps) {
  const host = useRichEditorSession(props);
  return <div ref={host} className="md md--wide rich-markdown" />;
}

/**
 * The editor for a description. The text is read when the session starts; a change is reported
 * only after the reader changes the text, and the value is replaced only when the parent gives a
 * different one.
 */
export default function RichMarkdownEditorImpl({
  value,
  onChange,
  onCursorChange,
  placeholder = '',
  'aria-label': label,
  disabled = false,
  resolveAttachment,
  resolveImage,
  ref,
}: RichMarkdownEditorProps) {
  const { t } = useTranslation();
  const reported = useRef(value);
  const [session, setSession] = useState({ id: 0, text: value });

  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    setSession((current) => ({ id: current.id + 1, text: value }));
  }, [value]);

  return (
    <EditorSession
      key={session.id}
      text={session.text}
      label={label}
      placeholder={placeholder}
      disabled={disabled}
      noImageLabel={t('markdown.noImage')}
      diagramError={(message) => t('markdown.diagramError', { message })}
      resolveAttachment={resolveAttachment}
      resolveImage={resolveImage}
      onReport={(markdownText) => {
        reported.current = markdownText;
        onChange(markdownText);
      }}
      onCursorChange={onCursorChange}
      handle={ref}
    />
  );
}
