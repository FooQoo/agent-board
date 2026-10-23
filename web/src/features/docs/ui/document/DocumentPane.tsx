import { CircleAlertIcon, LockIcon, RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { ConflictBanner } from './ConflictBanner';
import { FrontmatterBlock } from './FrontmatterBlock';
import './document.css';
import '@/shared/i18n/docs-strings';

export interface DocumentPaneProps {
  /** `loading` and `error` replace the body; `ready` shows the editor passed as `children`. */
  state: 'loading' | 'error' | 'ready';
  /** The front matter as the file holds it (with its `---` lines); shown above the body, never edited. */
  frontmatter?: string | null;
  /** The file cannot be edited or saved: a notice shows above the body. */
  readOnly?: boolean;
  /** The save found the file changed. The edit stays in `children`. */
  conflict?: boolean;
  onReload?: () => void;
  onOverwrite?: () => void;
  /** An overwrite is being saved. */
  conflictBusy?: boolean;
  /** For `error`: loads the file again. */
  onRetry?: () => void;
  /** The phone layout: smaller margins. */
  compact?: boolean;
  /** The small label above the body; "Markdown" unless the caller names another kind of file. */
  kindLabel?: string;
  /**
   * For an `.mdx` file: the body runs as MDX. The switch shows "UI" (`preview`, read-only) or
   * "Code" (`children`, editable); `children` stays mounted while the UI shows. Without it there
   * is no switch.
   */
  mdx?: { view: 'ui' | 'code'; onViewChange: (view: 'ui' | 'code') => void; preview: ReactNode };
  /** The body, the `RichMarkdownEditor`. */
  children?: ReactNode;
}

/**
 * The frame of the center pane: conflict notice, read-only notice, the kind label, the folded
 * front matter, and the body. Loading and failure replace the body. The footer's save state belongs
 * to `EditorShell`.
 */
export function DocumentPane({
  state,
  frontmatter = null,
  readOnly = false,
  conflict = false,
  onReload,
  onOverwrite,
  conflictBusy = false,
  onRetry,
  compact = false,
  kindLabel,
  mdx,
  children,
}: DocumentPaneProps) {
  const { t } = useTranslation();

  if (state === 'loading') {
    return (
      <div className="docs-doc" data-compact={compact ? 'true' : undefined} data-state="loading">
        <div className="docs-doc__skeleton" role="status" aria-label={t('docsDocument.loading')}>
          <span className="docs-doc__bone docs-doc__bone--title" />
          <span className="docs-doc__bone" />
          <span className="docs-doc__bone" />
          <span className="docs-doc__bone" />
          <span className="docs-doc__bone docs-doc__bone--short" />
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="docs-doc" data-compact={compact ? 'true' : undefined} data-state="error">
        <div className="docs-doc__failure" role="alert">
          <CircleAlertIcon aria-hidden="true" className="docs-doc__failure-icon" />
          <strong className="docs-doc__failure-title">{t('docsDocument.loadErrorTitle')}</strong>
          <span className="docs-doc__failure-body">{t('docsDocument.loadErrorBody')}</span>
          {onRetry && (
            <Button type="button" variant="outline" size="s" onClick={onRetry}>
              <RefreshCwIcon aria-hidden="true" />
              {t('docsDocument.reload')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="docs-doc" data-compact={compact ? 'true' : undefined} data-state="ready">
      {conflict && (
        <ConflictBanner
          busy={conflictBusy}
          onReload={() => onReload?.()}
          onOverwrite={() => onOverwrite?.()}
        />
      )}
      {readOnly && (
        <div className="docs-doc__readonly" role="status">
          <LockIcon aria-hidden="true" />
          <span>{t('docsDocument.readOnly')}</span>
        </div>
      )}
      <div className="docs-doc__head">
        <span className="docs-doc__kind">{kindLabel ?? t('docsDocument.kind')}</span>
        {mdx && (
          <div className="docs-doc__switch" role="group" aria-label={t('docsDocument.viewSwitch')}>
            {(['ui', 'code'] as const).map((view) => (
              <button
                key={view}
                type="button"
                className="docs-doc__switch-button"
                aria-pressed={mdx.view === view}
                onClick={() => mdx.onViewChange(view)}
              >
                {view === 'ui' ? t('docsDocument.viewUi') : t('docsDocument.viewCode')}
              </button>
            ))}
          </div>
        )}
      </div>
      {frontmatter ? <FrontmatterBlock source={frontmatter} /> : null}
      <div className="docs-doc__body" hidden={mdx?.view === 'ui'}>
        {children}
      </div>
      {mdx?.view === 'ui' && <div className="docs-doc__body">{mdx.preview}</div>}
    </div>
  );
}
