import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import { RouterProvider } from './contexts/RouterContext';
import { I18nProvider } from './contexts/I18nContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { OracleQuotaProvider } from './contexts/OracleQuotaContext';
import PWAUpdatePrompt from './components/PWAUpdatePrompt.jsx';
import { ConfirmProvider } from './components/primitives/ConfirmDialog.jsx';
import './styles/main.scss';
// Side-effect import: must register beforeinstallprompt before any view mounts.
import './lib/device/installPrompt';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <DataProvider>
            <OracleQuotaProvider>
              <RouterProvider>
                <ConfirmProvider>
                  <App />
                </ConfirmProvider>
              </RouterProvider>
            </OracleQuotaProvider>
          </DataProvider>
        </AuthProvider>
        <PWAUpdatePrompt />
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>
);
