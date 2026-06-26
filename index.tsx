import React from 'react';
import './src/index.css';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './contexts/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// MOBILE-AGENT: Service Worker registration with update-on-new-version flow.
//
// IMPORTANT: only register the SW in a production build. In dev, a stale SW
// would serve the cached old bundle and make HMR/edits invisible — so in dev
// we actively unregister any existing SW and nuke its caches so the live Vite
// content always wins.
if (import.meta.env.PROD) {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('SW registered:', reg);

          // When a new SW takes over, reload once so the user gets the new build.
          let refreshing = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
          });

          // Detect new SW installations and trigger SKIP_WAITING.
          const trigger = (worker: ServiceWorker | null) => {
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                worker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          };

          if (reg.waiting) trigger(reg.waiting);
          reg.addEventListener('updatefound', () => trigger(reg.installing));
        })
        .catch(err => console.error('SW registration failed:', err));
    });
  }
} else if ('serviceWorker' in navigator) {
  // DEV: evict any service worker + caches left over from a prior prod/PWA load.
  navigator.serviceWorker.getRegistrations().then((regs) => {
    let hadOne = false;
    regs.forEach((r) => { r.unregister(); hadOne = true; });
    if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    if (hadOne) {
      console.warn('[dev] Removed a stale service worker + caches. Reloading once for a clean slate…');
      // One reload so the page is no longer SW-controlled.
      setTimeout(() => window.location.reload(), 250);
    }
  });
}
