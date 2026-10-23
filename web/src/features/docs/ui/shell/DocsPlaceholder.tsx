import { CheckIcon, CopyIcon, FileTextIcon, FolderOpenIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import './docs-shell.css';
import '@/shared/i18n/docs-strings';

export interface DocsPlaceholderProps {
  kind: 'noFile' | 'noDocs';
  /** The folder the docs live in; the no-docs guidance names it. */
  rootPath?: string;
  /** The short form above the file list on a phone (no file chosen only). */
  compact?: boolean;
}

/**
 * The guidance of the center pane: no file is chosen yet, or the project has no docs and the
 * guidance names the folder to put them in. On a phone the first one sits above the file list.
 */
export function DocsPlaceholder({ kind, rootPath = '', compact = false }: DocsPlaceholderProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (kind === 'noFile') {
    return compact ? (
      <div className="docs-placeholder docs-placeholder--compact">
        <h2 className="docs-placeholder__title">{t('docs.noFileTitle')}</h2>
        <p className="docs-placeholder__body">{t('docs.noFilePhoneBody')}</p>
      </div>
    ) : (
      <div className="docs-placeholder">
        <FileTextIcon aria-hidden="true" className="docs-placeholder__icon" />
        <h2 className="docs-placeholder__title">{t('docs.noFileTitle')}</h2>
        <p className="docs-placeholder__body">{t('docs.noFileBody')}</p>
      </div>
    );
  }

  const copy = () => {
    void navigator.clipboard?.writeText(rootPath).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <div className="docs-placeholder">
      <FolderOpenIcon aria-hidden="true" className="docs-placeholder__icon" />
      <h2 className="docs-placeholder__title">{t('docs.emptyTitle')}</h2>
      <p className="docs-placeholder__body">{t('docs.emptyBody')}</p>
      <div className="docs-placeholder__path">
        <code>{rootPath}</code>
        <Button
          type="button"
          variant="ghost"
          size="s"
          iconOnly
          aria-label={copied ? t('docs.copied') : t('docs.copyPath')}
          onClick={copy}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}
