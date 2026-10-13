import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { bootPostHog } from './posthog';

// Crash reporting boots before React renders so a crash in the very first
// render is still seen. No-op without REACT_APP_POSTHOG_KEY (v529).
bootPostHog();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
