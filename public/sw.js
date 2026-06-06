// MOBILE-AGENT: minimal, dependency-free service worker for Echo PWA.
// v2 — adds offline shell, GET-only handling, cross-origin pass-through (so
// Gemini/Groq/OpenRouter calls are never intercepted), and SKIP_WAITING msg.

const CACHE_NAME = 'echo-cache-v3';
const OFFLINE_SHELL = '/index.html';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo192.png',
  '/logo512.png',
  '/ai-avatar.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .catch(() => { /* missing asset shouldn't break install */ })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ignore non-GET (POST/PUT/etc. — e.g. LLM API calls)
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Ignore cross-origin — let the browser handle Gemini/Groq/OpenRouter directly
  if (url.origin !== self.location.origin) return;

  // For SPA navigations, fall back to cached shell when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_SHELL).then((r) => r || Response.error()))
    );
    return;
  }
  // Otherwise: Network-First strategy (try network, fallback to cache)
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => { });
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || Response.error()))
  );
});

// Allow the page to force an update
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push notifications for reminders (existing behaviour preserved)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
