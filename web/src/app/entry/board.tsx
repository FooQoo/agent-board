import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NuqsAdapter } from 'nuqs/adapters/react';
import '../../shared/i18n';
import { App } from '../App';
import { readMockInitial } from '../development/mock';
import { initializeTheme } from '../../shared/theme';
import { syncPreferences } from '../../shared/preferences';
import { readToken } from '../../shared/api/http';
import '../../shared/styles/tokens.css';
import '../../shared/styles/app.css';
import '../../shared/styles/resize.css';
import '../../shared/styles/ui.css';
import '../../shared/styles/theme.css';

initializeTheme();
// The sample-data mode and the demo have no server to keep the language and theme: they stay in
// the browser. Otherwise the browser copy painted the first screen, and the board's saved value
// replaces it when it differs.
const serverless = import.meta.env.MODE === 'mock' || import.meta.env.MODE === 'demo';
if (!serverless) void syncPreferences({ url: '/api/preferences', token: readToken });

const initial =
  import.meta.env.MODE === 'mock' ? readMockInitial(window.location.search) : undefined;

function render(): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root not found');
  if (import.meta.env.MODE === 'mock' && new URLSearchParams(window.location.search).has('view')) {
    // Sample-data mode only: a single part on its own page (see `src/mockMarkdown.tsx`).
    void import('../development/MarkdownSample').then(({ MarkdownSample }) => {
      createRoot(root).render(<MarkdownSample search={window.location.search} />);
    });
  } else
    createRoot(root).render(
      <StrictMode>
        <NuqsAdapter>
          <App initial={initial} />
        </NuqsAdapter>
      </StrictMode>,
    );
}

// The demo build answers the board's requests in the page; that is in place before the first one.
if (import.meta.env.MODE === 'demo')
  void import('../development/demo/install').then(({ installDemo }) => {
    installDemo();
    render();
  });
else render();
