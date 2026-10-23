import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isSandboxReply, type SandboxRenderMessage } from '@/shared/docs-sandbox/protocol';
import '@/shared/i18n/docs-strings';

/** The sandbox page the board serves; it runs the MDX. */
export const SANDBOX_URL = '/docs-sandbox';

export interface MdxFrameProps {
  /** The MDX to run: the body as it is now, saved or not. */
  source: string;
}

/**
 * Runs `source` as MDX in an iframe that is cut off from the board: `sandbox="allow-scripts"`
 * without `allow-same-origin` gives the page an opaque origin, so it reaches neither this page, its
 * storage nor the token, and the page's own CSP forbids every connection. The two pages only talk
 * by `postMessage`; messages from any other window are ignored.
 */
export function MdxFrame({ source }: MdxFrameProps) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  const [height, setHeight] = useState<number | null>(null);

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
      if (event.data.type === 'rendered' || event.data.type === 'height')
        setHeight(Math.ceil(event.data.height));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

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
        style={height === null ? undefined : { height }}
      />
    </div>
  );
}
