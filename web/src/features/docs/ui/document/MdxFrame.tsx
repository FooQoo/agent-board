import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isSandboxReply,
  SANDBOX_THEME_TOKENS,
  type SandboxRenderMessage,
  type SandboxThemeMessage,
} from '@/shared/docs-sandbox/protocol';
import '@/shared/i18n/docs-strings';

/** The sandbox page the board serves; it runs the MDX. */
export const SANDBOX_URL = '/docs-sandbox';

export interface MdxFrameProps {
  /** The MDX to run: the body as it is now, saved or not. */
  source: string;
  /** A link in the document was chosen; `href` is as the document wrote it. */
  onLink?: (href: string) => void;
}

/**
 * Runs `source` as MDX in an iframe that is cut off from the board: `sandbox="allow-scripts"`
 * without `allow-same-origin` gives the page an opaque origin, so it reaches neither this page, its
 * storage nor the token, and the page's own CSP forbids every connection. The two pages only talk
 * by `postMessage`; messages from any other window are ignored.
 */
export function MdxFrame({ source, onLink }: MdxFrameProps) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  // The latest handler, so the message listener does not have to be added again when it changes.
  const linkHandler = useRef(onLink);
  useEffect(() => {
    linkHandler.current = onLink;
  }, [onLink]);

  const send = useCallback(() => {
    const message: SandboxRenderMessage = {
      type: 'render',
      source,
      labels: {
        unregistered: t('docsDocument.mdxUnregistered'),
        runtimeError: t('docsDocument.mdxRuntimeError'),
      },
    };
    // The frame's origin is opaque, so only '*' can address it; it is the window we created.
    frame.current?.contentWindow?.postMessage(message, '*');
  }, [source, t]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === null || event.source !== frame.current?.contentWindow) return;
      if (!isSandboxReply(event.data)) return;
      if (event.data.type === 'ready') setReady(true);
      else if (event.data.type === 'rendered') setShown(true);
      else if (event.data.type === 'link') linkHandler.current?.(event.data.href);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // The board's theme as the frame sees it, sent before the first body and again whenever the
  // theme on the document changes (`applyTheme` sets these attributes).
  useEffect(() => {
    if (!ready) return;
    const sendTheme = () => {
      const element = frame.current;
      if (element === null) return;
      const style = getComputedStyle(element);
      const tokens: SandboxThemeMessage['tokens'] = {};
      for (const name of SANDBOX_THEME_TOKENS) {
        const value = style.getPropertyValue(name).trim();
        if (value !== '') tokens[name] = value;
      }
      const root = document.documentElement;
      const message: SandboxThemeMessage = {
        type: 'theme',
        colorScheme: root.classList.contains('dark') ? 'dark' : 'light',
        tokens,
      };
      element.contentWindow?.postMessage(message, '*');
    };
    sendTheme();
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-mode', 'data-accent'],
    });
    return () => observer.disconnect();
  }, [ready]);

  // Send the body when the page is ready, and again whenever it changes.
  useEffect(() => {
    if (ready) send();
  }, [ready, send]);

  return (
    <div className="docs-mdx" data-shown={shown ? 'true' : undefined}>
      {!shown && (
        <p className="docs-mdx__loading" role="status">
          {t('docsDocument.mdxLoading')}
        </p>
      )}
      <iframe
        ref={frame}
        className="docs-mdx__frame"
        title={t('docsDocument.mdxPreview')}
        src={SANDBOX_URL}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
