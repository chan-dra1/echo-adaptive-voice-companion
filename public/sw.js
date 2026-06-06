// MOBILE-AGENT: minimal, dependency-free service worker for Echo PWA.
// v3 — adds companion background heartbeat: periodic reminders + deadline
// nudges sent as push-style notifications even when the tab is backgrounded.

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

// Allow the page to force an update + companion message passing
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // COMPANION: schedule a background notification
  // Payload: { type: 'SCHEDULE_NOTIFICATION', title, body, delayMs, tag }
  if (event.data.type === 'SCHEDULE_NOTIFICATION') {
    const { title, body, delayMs = 0, tag = 'echo-companion' } = event.data;
    setTimeout(async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const hasFocused = clients.some(c => c.focused);
      if (hasFocused) {
        clients.filter(c => c.focused).forEach(c => c.postMessage({ type: 'IN_APP_NOTIFY', title, body, tag }));
        return;
      }
      if (self.registration && self.registration.showNotification) {
        await self.registration.showNotification(title, {
          body,
          icon: '/ai-avatar.png',
          badge: '/logo192.png',
          tag,
          renotify: false,
          data: { url: '/' },
        });
      }
    }, delayMs);
    return;
  }

  if (event.data.type === 'CANCEL_NOTIFICATION') {
    const { tag } = event.data;
    if (tag && self.registration) {
      self.registration.getNotifications({ tag }).then(ns => ns.forEach(n => n.close()));
    }
    return;
  }
});

// Notification click — open or focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// Periodic background sync — heartbeat nudge (Android Chrome only)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'echo-companion-heartbeat') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        const hasActive = clients.some(c => c.visibilityState === 'visible');
        if (!hasActive && self.registration) {
          self.registration.showNotification('Echo is here 💙', {
            body: 'Tap to check in — your habits and goals are waiting.',
            icon: '/ai-avatar.png',
            tag: 'echo-heartbeat',
            renotify: false,
          });
        }
      })
    );
  }
});
