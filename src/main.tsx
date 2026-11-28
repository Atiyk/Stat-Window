import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans/wght.css';
import './styles.css';
import { App } from './App';
import { puzzleDay } from './engine/daily';
import { startAnalytics, trackOnce } from './lib/track';
import { OriginTransfer } from './lib/save-transfer';

startAnalytics();

createRoot(document.getElementById('root')!, {
  onUncaughtError(error) {
    const day = puzzleDay(new Date());
    trackOnce(`game-failure:${day}`, day, { name: 'failure', source: 'game' });
    if (typeof reportError === 'function') reportError(error);
    else console.error(error);
  },
}).render(
  <StrictMode>
    <OriginTransfer><App /></OriginTransfer>
  </StrictMode>,
);
