import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { GlobalAlertProvider } from '@/providers/GlobalAlertProvider';
import { UpdateProvider } from '@/providers/UpdateProvider';
import '@/i18n';
import './index.css';
import App from './App.tsx';
import { requestJson } from '@/services/transport';

declare global {
  interface Window {
    __WEBOT_API__?: {
      requestJson: typeof requestJson;
    };
  }
}

window.__WEBOT_API__ = {
  requestJson,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ThemeProvider>
        <GlobalAlertProvider>
          <UpdateProvider>
            <App />
          </UpdateProvider>
        </GlobalAlertProvider>
      </ThemeProvider>
    </HashRouter>
  </StrictMode>,
);
