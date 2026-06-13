import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { GameProvider } from './store/GameContext.jsx';
import { Analytics } from '@vercel/analytics/react';
import './index.css';

// Hide the static SEO landing page now that JS has loaded
document.getElementById('seo-landing')?.remove();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GameProvider>
      <App />
    </GameProvider>
    <Analytics />
  </React.StrictMode>
);
