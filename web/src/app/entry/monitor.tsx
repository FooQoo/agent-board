import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { App } from '../../pages/monitor/App';
import { useBuildReload } from '../model/useBuildReload';
import { initializeTheme } from '../../shared/theme';
import '../../shared/i18n';
import '../../shared/styles/tokens.css';
import '../../shared/styles/app.css';
import '../../shared/styles/ui.css';
import '../../shared/styles/modal.css';
import '../../shared/styles/theme.css';
import '../../features/tasks/answer/decision-request.css';
import '../../pages/monitor/monitor.css';

initializeTheme();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <NuqsAdapter>
      <App useBuildReload={useBuildReload} />
    </NuqsAdapter>
  </StrictMode>,
);
