import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NuqsAdapter } from 'nuqs/adapters/react';
import './i18n';
import { App } from './App';
import { readMockInitial } from './mock';
import { initializeTheme } from './theme';
import './styles/tokens.css';
import './styles/app.css';
import './styles/resize.css';
import './styles/ui.css';
import './styles/theme.css';

initializeTheme();

const initial =
  import.meta.env.MODE === 'mock' ? readMockInitial(window.location.search) : undefined;

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
if (import.meta.env.MODE === 'mock' && new URLSearchParams(window.location.search).has('view')) {
  // Sample-data mode only: a single part on its own page (see `src/mockMarkdown.tsx`).
  void import('./mockMarkdown').then(({ MarkdownSample }) => {
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
