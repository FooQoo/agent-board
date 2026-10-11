import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { App } from './monitor/App';
import { initializeTheme } from './theme';
import './i18n';
import './styles/tokens.css';
import './styles/app.css';
import './styles/ui.css';
import './styles/modal.css';
import './styles/theme.css';
import './monitor/monitor.css';

initializeTheme();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <NuqsAdapter>
      <App />
    </NuqsAdapter>
  </StrictMode>,
);
