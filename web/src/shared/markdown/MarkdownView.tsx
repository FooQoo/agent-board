import { ImageOffIcon, SquareCheckIcon, SquareIcon } from 'lucide-react';
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useTranslation } from 'react-i18next';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { imageUrlOf, safeLinkUrl, type AttachmentResolver } from './model';
import { Lightbox } from '../ui/lightbox/Lightbox';
import { MermaidDiagram } from './MermaidDiagram';
import './markdown.css';

export type MarkdownVariant = 'compact' | 'wide';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
/** Two or more images that follow each other without text form one row of small captures. */
const CAPTURE_ROW_MIN = 2;

const ResolverContext = createContext<AttachmentResolver | undefined>(undefined);

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

/**
 * An image: a picture that opens enlarged on a press, or the placeholder when it cannot be shown.
 * A failed load is remembered per URL, so a new reference is tried again.
 */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const { t } = useTranslation();
  const resolve = useContext(ResolverContext);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const url = imageUrlOf(src, resolve);
  const text = alt ?? '';
  const name = text !== '' ? text : t('markdown.image');
  if (url === null || failedUrl === url) return <ImagePlaceholder alt={text} />;
  return (
    <span className="md__image">
      <button
        type="button"
        className="md__image-open"
        aria-label={t('markdown.enlargeImage', { name })}
        onClick={() => setEnlarged(true)}
      >
        <img
          className="md__image-picture"
          src={url}
          alt={text}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailedUrl(url)}
        />
      </button>
      {text !== '' && <span className="md__image-caption">{text}</span>}
      {enlarged && (
        <Lightbox label={name} onClose={() => setEnlarged(false)}>
          <img src={url} alt={text} referrerPolicy="no-referrer" />
        </Lightbox>
      )}
    </span>
  );
}

/** The `img` component of the Markdown renderer; the paragraph grouping recognizes its elements. */
function MarkdownImageNode({ src, alt }: { src?: string; alt?: string }) {
  return <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt} />;
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

function isImageElement(node: ReactNode): node is ReactElement {
  return isValidElement(node) && node.type === MarkdownImageNode;
}

/** A line break, or the white space between two images on consecutive lines. */
function isBetweenImages(node: ReactNode): boolean {
  if (typeof node === 'string') return node.trim() === '';
  return isValidElement(node) && node.type === 'br';
}

/**
 * Images that follow each other with nothing but line breaks between them form one row of small
 * captures. Any other child is returned as it is, so text and a lone image keep their layout.
 */
function groupCaptures(children: ReactNode): ReactNode {
  const output: ReactNode[] = [];
  let run: ReactNode[] = [];
  let images: ReactElement[] = [];

  const flush = () => {
    if (images.length >= CAPTURE_ROW_MIN) {
      output.push(
        <span className="md-captures" key={`captures-${output.length}`}>
          {images}
        </span>,
      );
    } else {
      output.push(...run);
    }
    run = [];
    images = [];
  };

  for (const node of Children.toArray(children)) {
    if (isImageElement(node)) {
      run.push(node);
      images.push(node);
    } else if (images.length > 0 && isBetweenImages(node)) {
      run.push(node);
    } else {
      flush();
      output.push(node);
    }
  }
  flush();
  return output;
}

/** The source of a Mermaid block: the text of its only `code` child, or null for other blocks. */
function mermaidSourceOf(children: ReactNode): string | null {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null;
  if (!/(^|\s)language-mermaid(\s|$)/.test(child.props.className ?? '')) return null;
  return String(child.props.children ?? '').replace(/\n$/, '');
}

const COMPONENTS: Components = {
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  img: MarkdownImageNode,
  input: ({ type, checked }) => <MarkdownCheckbox type={type} checked={checked} />,
  table: ({ children }) => (
    <div className="md-scroll">
      <table>{children}</table>
    </div>
  ),
  p: ({ children }) => <p>{groupCaptures(children)}</p>,
  li: ({ className, children }) => <li className={className}>{groupCaptures(children)}</li>,
  pre: ({ children }) => {
    const source = mermaidSourceOf(children);
    return source === null ? <pre>{children}</pre> : <MermaidDiagram source={source} />;
  },
};

/**
 * GitHub-flavored Markdown as React elements. Raw HTML is shown as text (there is no HTML
 * plugin), a single newline is a line break, and URLs are checked here, not by the library.
 */
export const MarkdownView = memo(function MarkdownView({
  source,
  variant = 'compact',
  resolveAttachment,
}: {
  source: string;
  variant?: MarkdownVariant;
  resolveAttachment?: AttachmentResolver;
}) {
  return (
    <ResolverContext.Provider value={resolveAttachment}>
      <div className={`md md--${variant}`}>
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          components={COMPONENTS}
          urlTransform={(url) => url}
        >
          {source}
        </ReactMarkdown>
      </div>
    </ResolverContext.Provider>
  );
});
