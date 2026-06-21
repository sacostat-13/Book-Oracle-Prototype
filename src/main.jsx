import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './lib/AuthContext';
import { DataProvider } from './lib/DataContext';
import { RouterProvider } from './lib/RouterContext';
import { I18nProvider } from './lib/I18nContext';
import { ThemeProvider } from './lib/ThemeContext';
import './styles/main.scss';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <DataProvider>
            <RouterProvider>
              <App />
            </RouterProvider>
          </DataProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>
);
