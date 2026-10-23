import { CircleAlertIcon, FileIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './document.css';

export interface FileViewerProps {
  /** `image` shows the picture at `src`; `other` says the file cannot be shown. */
  kind: 'image' | 'other';
  /** The file's name, as the alternative text of an image or under the notice. */
  name: string;
  /** The image's URL, for `image`. */
  src?: string;
}

/**
 * The body for a file that is not Markdown: an image (with its loading and failed states) or the
 * notice for a file the docs do not show. Nothing here is editable.
 */
export function FileViewer({ kind, name, src }: FileViewerProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<{
    src: string | undefined;
    status: 'loading' | 'ready' | 'error';
  }>({
    src,
    status: 'loading',
  });
  const status = state.src === src ? state.status : 'loading';

  if (kind === 'other') {
    return (
      <div className="docs-doc__failure" role="status">
        <FileIcon
          aria-hidden="true"
          className="docs-doc__failure-icon docs-doc__failure-icon--muted"
        />
        <strong className="docs-doc__failure-title">{t('docsDocument.unsupportedTitle')}</strong>
        <span className="docs-doc__file-name">{name}</span>
        <span className="docs-doc__failure-body">{t('docsDocument.unsupportedBody')}</span>
      </div>
    );
  }

  return (
    <>
      {status === 'loading' && (
        <div
          className="docs-doc__skeleton"
          role="status"
          aria-label={t('docsDocument.imageLoading')}
        >
          <span className="docs-doc__bone docs-doc__bone--title" />
          <span className="docs-doc__bone" />
        </div>
      )}
      {status === 'error' && (
        <div className="docs-doc__failure" role="alert">
          <CircleAlertIcon aria-hidden="true" className="docs-doc__failure-icon" />
          <strong className="docs-doc__failure-title">{t('docsDocument.imageErrorTitle')}</strong>
          <span className="docs-doc__file-name">{name}</span>
        </div>
      )}
      <img
        key={src}
        className="docs-doc__image"
        src={src}
        alt={name}
        hidden={status !== 'ready'}
        onLoad={() => setState({ src, status: 'ready' })}
        onError={() => setState({ src, status: 'error' })}
      />
    </>
  );
}
