import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import { App } from './App';
import { readMockInitial } from './mock';
import './styles/tokens.css';
import './styles/app.css';
import './styles/resize.css';

const initial = import.meta.env.MODE === 'mock' ? readMockInitial(window.location.search) : undefined;

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App initial={initial} />
  </StrictMode>,
);
