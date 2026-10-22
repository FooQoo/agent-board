import { ChevronDownIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './document.css';

export interface FrontmatterBlockProps {
  /** The front matter exactly as the file holds it, with its `---` lines. */
  source: string;
  defaultOpen?: boolean;
}

/** The lines between the `---` fences. */
function innerLines(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  if (/^---\s*$/.test(lines[0] ?? '')) lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  if (/^(---|\.\.\.)\s*$/.test(lines[lines.length - 1] ?? '')) lines.pop();
  return lines;
}

/** Top-level `key:` lines; indented and list lines belong to the item above. */
function countItems(lines: string[]): number {
  return lines.filter((line) => /^[^\s#-][^:]*:/.test(line)).length;
}

/**
 * The front matter above the body. It is shown for reading only and folds; the file's own text
 * is put back on save, so it is never part of what the editor edits.
 */
export function FrontmatterBlock({ source, defaultOpen = true }: FrontmatterBlockProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const lines = innerLines(source);

  return (
    <section className="docs-frontmatter" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="docs-frontmatter__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDownIcon aria-hidden="true" className="docs-frontmatter__chevron" />
        <span className="docs-frontmatter__title">{t('docsDocument.frontmatter')}</span>
        <span className="docs-frontmatter__count">
          {t('docsDocument.frontmatterCount', { count: countItems(lines) })}
        </span>
      </button>
      <pre id={bodyId} className="docs-frontmatter__body" hidden={!open}>
        {lines.join('\n')}
      </pre>
    </section>
  );
}
