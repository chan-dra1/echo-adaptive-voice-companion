# Echo — Native Shell (Capacitor) Prep

This folder is **scaffolding only**. Nothing is installed yet — the existing PWA still
ships as-is. When you're ready to wrap Echo as a real iOS / Android app for true
background voice, follow the steps below.

> **Why bother?** Pure PWA mode loses the microphone the moment the screen locks
> or the tab is fully backgrounded. A Capacitor shell can keep audio + a foreground
> service running the way a real native app does.

---

## 1. Install Capacitor

```bash
# from the repo root
npm i -D @capacitor/cli @capacitor/core @capacitor/ios @capacitor/android
npx cap init "Echo" "com.echo.agent" --web-dir=dist
```

Then move (or rename) `capacitor.config.ts.example` (at the repo root) to
`capacitor.config.ts` and tweak `appId` / `appName` to taste.

## 2. Build the web bundle

```bash
npm run build          # vite build -> dist/
npx cap add ios
npx cap add android
npx cap sync
```

## 3. Plugins you'll want

| Concern               | Plugin                                               |
| --------------------- | ---------------------------------------------------- |
| Keep screen awake     | `@capacitor/wake-lock` (or our `wakeLockService`)    |
| Local notifications   | `@capacitor/local-notifications`                     |
| Push notifications    | `@capacitor/push-notifications`                      |
| Android foreground service / iOS background audio | `@capgo/capacitor-background-mode` (or `@capacitor-community/background-mode`) |
| Microphone permission | `@capacitor/core` + native permission prompts         |
| Filesystem            | `@capacitor/filesystem`                              |

```bash
# Do NOT run this until you've installed Capacitor core.
npm i @capacitor/wake-lock \
      @capacitor/local-notifications \
      @capacitor/push-notifications \
      @capgo/capacitor-background-mode
```

## 4. Required Permissions

### iOS (`ios/App/App/Info.plist`)

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Echo listens to your voice to respond in real time.</string>
<key>NSCameraUsageDescription</key>
<string>Echo can see your surroundings on request.</string>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
  <string>processing</string>
  <string>remote-notification</string>
</array>
```

Apple is strict about `audio` background mode — your app must be playing or
recording **continuously** for iOS to keep it alive. The Live session already
streams audio, which qualifies.

### Android (`android/app/src/main/AndroidManifest.xml`)

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.WAKE_LOCK"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE"/>
```

Android requires a **foreground service with a persistent notification** for any
app that uses the mic while backgrounded (since Android 14). The background-mode
plugin handles the boilerplate.

## 5. Bridging into Echo's services

The web side is already prepared. `services/wakeLockService.ts` exposes:

```ts
import { wakeLockService } from '../services/wakeLockService';
import { WakeLock } from '@capacitor/wake-lock';

wakeLockService.registerNativeBridge({
  acquire: () => WakeLock.keepAwake(),
  release: () => WakeLock.allowSleep(),
  isSupported: () => true,
});
```

Then anywhere you call `wakeLockService.acquire({ useNativeBridge: true })`
the request will route through the Capacitor plugin instead of the browser API.

## 6. Build native

```bash
npx cap open ios       # opens Xcode
npx cap open android   # opens Android Studio
```

Sign + ship per the standard App Store / Play flows.

---

## What you get vs. PWA

|                                    | PWA (today) | Capacitor shell |
| ---------------------------------- | :---------: | :-------------: |
| Mic while screen locked            |     ❌      |       ✅        |
| Mic while another app foregrounded |     ❌      |       ✅        |
| True push notifications (iOS)      |   limited   |       ✅        |
| App Store / Play Store listing     |     ❌      |       ✅        |
| Install size                       |   tiny      |   ~30–60 MB     |
| Update without review              |     ✅      |       ❌        |
