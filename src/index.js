import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installA11y } from './a11y';

installA11y();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
