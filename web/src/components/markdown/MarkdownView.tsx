import { ImageOffIcon, SquareCheckIcon, SquareIcon } from 'lucide-react';
import { memo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useTranslation } from 'react-i18next';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { safeImageUrl, safeLinkUrl } from '../../lib/markdown';
import '../../styles/markdown.css';

export type MarkdownVariant = 'compact' | 'wide';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/** A link that passes the allow-list opens in a new tab; any other target is shown as text. */
function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const safe = href === undefined ? null : safeLinkUrl(href);
  if (safe === null) return <span className="md__plain-link">{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function ImagePlaceholder({ alt }: { alt: string }) {
  const { t } = useTranslation();
  return (
    <span className="md__image">
      <span className="md__image-none">
        <ImageOffIcon aria-hidden="true" />
        <span className="md__image-none-label">{t('markdown.noImage')}</span>
      </span>
      {alt !== '' && <span className="md__image-caption">{alt}</span>}
    </span>
  );
}

/** Only an external http(s) image is fetched. A failed load turns into the placeholder. */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const safe = src === undefined ? null : safeImageUrl(src);
  const text = alt ?? '';
  if (safe === null || failed) return <ImagePlaceholder alt={text} />;
  return (
    <span className="md__image">
      <img
        className="md__image-picture"
        src={safe}
        alt={text}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {text !== '' && <span className="md__image-caption">{text}</span>}
    </span>
  );
}

/** A checklist box is a display only: it is disabled, out of the tab order and has no handler. */
function MarkdownCheckbox({ type, checked }: { type?: string; checked?: boolean }) {
  if (type !== 'checkbox') return null;
  return (
    <span className={`md__check${checked ? ' md__check--on' : ''}`}>
      <input type="checkbox" checked={checked === true} disabled readOnly tabIndex={-1} />
      {checked ? <SquareCheckIcon aria-hidden="true" /> : <SquareIcon aria-hidden="true" />}
    </span>
  );
}

const COMPONENTS: Components = {
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  img: ({ src, alt }) => (
    <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt} />
  ),
  input: ({ type, checked }) => <MarkdownCheckbox type={type} checked={checked} />,
  table: ({ children }) => (
    <div className="md-scroll">
      <table>{children}</table>
    </div>
  ),
};

/**
 * GitHub-flavored Markdown as React elements. Raw HTML is shown as text (there is no HTML
 * plugin), a single newline is a line break, and URLs are checked here, not by the library.
 */
export const MarkdownView = memo(function MarkdownView({
  source,
  variant = 'compact',
}: {
  source: string;
  variant?: MarkdownVariant;
}) {
  return (
    <div className={`md md--${variant}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={COMPONENTS}
        urlTransform={(url) => url}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
