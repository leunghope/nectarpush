import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import './styles/tailwind.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/pages.css';
import './styles/extra.css';

import { queryClient } from './api/queryClient';
import { initTheme } from './stores/theme';
import { App } from './App';

initTheme();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
