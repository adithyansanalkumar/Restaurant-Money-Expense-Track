import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/theme.css';
import { startSync } from './sync/sync';
import { resumeAdoptionIfPending } from './sync/onboard';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// then finish an adoption lookup that was interrupted (adoptPending), in the background
void startSync().then(() => resumeAdoptionIfPending()).catch(() => {});
