import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './lib/AuthContext';
import { DataProvider } from './lib/DataContext';
import { RouterProvider } from './lib/RouterContext';
import { I18nProvider } from './lib/I18nContext';
import { ThemeProvider } from './lib/ThemeContext';
import { OracleQuotaProvider } from './lib/OracleQuotaContext';
import './styles/main.scss';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <DataProvider>
            <OracleQuotaProvider>
              <RouterProvider>
                <App />
              </RouterProvider>
            </OracleQuotaProvider>
          </DataProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>
);
