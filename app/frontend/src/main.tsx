import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { ActiveTickerProvider } from './contexts/active-ticker-context';
import { NodeProvider } from './contexts/node-context';
import { ThemeProvider } from './providers/theme-provider';
import { LanguageProvider } from './contexts/language-context';

import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <ActiveTickerProvider>
        <ThemeProvider>
          <NodeProvider>
            <App />
          </NodeProvider>
        </ThemeProvider>
      </ActiveTickerProvider>
    </LanguageProvider>
  </React.StrictMode>
);
