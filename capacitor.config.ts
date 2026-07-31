import type { CapacitorConfig } from '@capacitor/cli';

// appId/appName match the identifiers Echo shipped under before the prior
// (now reversed) web-only PWA decision — see memory/capacitor-native-rebuild
// for why this exists again and what's been verified.
const config: CapacitorConfig = {
  appId: 'com.echo.agent',
  appName: 'Echo',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#010502', // matches --bg-base in src/index.css, not pure black
    },
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#010502',
  },
  android: {
    backgroundColor: '#010502',
  },
};

export default config;
