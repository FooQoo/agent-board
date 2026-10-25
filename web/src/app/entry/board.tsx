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
// The browser copy painted the first screen; the board's saved value replaces it when it differs.
if (import.meta.env.MODE !== 'mock')
  void syncPreferences({ url: '/api/preferences', token: readToken });

const initial =
  import.meta.env.MODE === 'mock' ? readMockInitial(window.location.search) : undefined;

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
