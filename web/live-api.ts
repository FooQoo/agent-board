import type { Plugin, ProxyOptions } from 'vite';

const TOKEN_PLACEHOLDER = '{{SKAN_TOKEN}}';
const TOKEN_PATTERN = /<meta name="skan-token" content="([0-9a-f]{64})"/;

/** Get the current delete token from the Rust server's rendered index. */
async function fetchToken(backendOrigin: string): Promise<string> {
  const response = await fetch(backendOrigin, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`agboard serve returned ${response.status}`);
  const token = (await response.text()).match(TOKEN_PATTERN)?.[1];
  if (!token) throw new Error('agboard serve did not return a delete token');
  return token;
}

/** Use the real board API while Vite serves the UI with HMR. */
export function liveApi(backendOrigin: string): Plugin {
  let currentToken: string | undefined;

  return {
    name: 'skan-live-api',
    apply: 'serve',
    async transformIndexHtml(html) {
      const token = await fetchToken(backendOrigin);
      currentToken = token;
      return html.replace(TOKEN_PLACEHOLDER, token);
    },
    configureServer(server) {
      const timer = setInterval(async () => {
        try {
          const token = await fetchToken(backendOrigin);
          if (currentToken && currentToken !== token) server.ws.send({ type: 'full-reload' });
          currentToken = token;
        } catch {
          // The Rust server is temporarily unavailable while cargo-watch rebuilds it.
        }
      }, 1_000);
      server.httpServer?.once('close', () => clearInterval(timer));
    },
  };
}

/** Keep the Rust delete guard's origin check intact behind the local proxy. */
export function liveProxy(backendOrigin: string, webOrigin: string): ProxyOptions {
  return {
    target: backendOrigin,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq, req) => {
        if (
          (req.method === 'DELETE' || req.method === 'POST') &&
          req.headers.origin === webOrigin &&
          req.headers['sec-fetch-site'] === 'same-origin'
        ) {
          proxyReq.setHeader('Origin', backendOrigin);
        }
      });
    },
  };
}
