import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    // Relative, not '/' (Vite's default). The built dist/ is shared between
    // the web/PWA deployment AND the Electron desktop build (both just run
    // `vite build`) — Electron's packaged app loads index.html via a
    // file:// path (main.js's loadFile(), non-dev mode only; dev mode always
    // points at the Vite dev server and never hits this). An absolute base
    // ('/assets/...') resolves against the OS filesystem root under file://,
    // not the app's own directory, so the JS bundle silently 404s and the
    // packaged app boots to a blank white screen — the div#root never gets
    // anything mounted into it, with no console error surfaced anywhere
    // obvious. Relative paths ('./assets/...') resolve correctly under both
    // a root-hosted static site AND file://, so this is a strict fix with no
    // downside for the web deployment.
    base: './',
    server: {
      port: 3000,
      // 127.0.0.1 avoids Node `os.networkInterfaces()` crashes in some sandboxes / restricted
      // environments. For phone-on-LAN testing: `npm run dev -- --host 0.0.0.0`
      host: process.env.VITE_DEV_HOST || '127.0.0.1',
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
