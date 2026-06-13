import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { GameProvider } from './store/GameContext.jsx';
import { Analytics } from '@vercel/analytics/react';
import './index.css';

// The static landing page stays in place as the front door for every visit.
// It is dismissed only when the user clicks "Play Free Now" (sets display:none),
// so there's no flash/flicker from JS removing it on load.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GameProvider>
      <App />
    </GameProvider>
    <Analytics />
  </React.StrictMode>
);
