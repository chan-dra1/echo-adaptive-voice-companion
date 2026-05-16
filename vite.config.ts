import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
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
