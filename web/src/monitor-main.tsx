import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './monitor/App';
import { initializeTheme } from './theme';
import './styles/tokens.css';
import './styles/theme.css';
import './monitor/monitor.css';

initializeTheme();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
