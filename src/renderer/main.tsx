import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// External files must be handled by an upload zone, never navigate Electron.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => {
    const drag = event as DragEvent;
    if (!drag.dataTransfer?.types.includes('Files')) return;
    drag.preventDefault();
    if (type === 'dragover') drag.dataTransfer.dropEffect = 'none';
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
