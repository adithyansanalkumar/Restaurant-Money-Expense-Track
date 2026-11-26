import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/theme.css';
import { startSync } from './sync/sync';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

void startSync();
