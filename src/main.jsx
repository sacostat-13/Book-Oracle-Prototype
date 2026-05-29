import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './lib/AuthContext';
import { DataProvider } from './lib/DataContext';
import { RouterProvider } from './lib/RouterContext';
import './styles/main.scss';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <DataProvider>
        <RouterProvider>
          <App />
        </RouterProvider>
      </DataProvider>
    </AuthProvider>
  </React.StrictMode>
);
