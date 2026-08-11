// electron/preload.js — the ONLY bridge between the sandboxed renderer
// (the existing React app, unmodified) and the main/Node process.
//
// Security posture: contextIsolation is ON and nodeIntegration is OFF (see
// main.js's BrowserWindow webPreferences), which means the renderer's
// `window` is a completely separate JS world from this script's — it
// cannot reach Node, ipcRenderer, or anything else in here unless we
// deliberately hand it over via contextBridge. We expose a small,
// read-only-feeling API object instead of raw ipcRenderer, so the renderer
// can never send arbitrary IPC channels or touch Node APIs (fs, child_process,
// etc.) even if the page content were somehow compromised (e.g. a bad
// dependency, an injected script). Keep this surface tiny — every export
// here is something a hostile web page could call.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('echoDesktop', {
  // Lets the renderer show something like "Echo v1.2.3 (desktop)" instead of
  // faking version info, and lets it branch UI ("you're running the app
  // shell, not the browser PWA") if useful.
  platform: process.platform, // 'darwin' | 'win32' | 'linux'
  appVersion: process.env.npm_package_version || ipcRenderer.sendSync('echo:get-app-version'),

  // Manual "check for updates" trigger (e.g. a button in a settings panel),
  // separate from the automatic launch-time check in updater.js. Fire-and-
  // forget from the renderer's perspective — result/progress arrives via the
  // onUpdate* subscriptions below, not a return value, since the actual
  // download can take a while and happens fully in the main process.
  checkForUpdates: () => ipcRenderer.send('echo:check-for-updates'),

  // Subscriptions for update lifecycle events broadcast from updater.js, so
  // the UI can show "update available" / "downloading" / "restart to
  // install" banners without any of this involving raw ipcRenderer.on()
  // (and its untamed event object) in the renderer. Each returns an
  // unsubscribe function.
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('echo:update-status', handler);
    return () => ipcRenderer.removeListener('echo:update-status', handler);
  },

  // Surfaces whether Echo Core (the terminal-brain daemon) was actually
  // auto-started successfully, so the UI can show an honest connection
  // status instead of just failing silently when a WS connect to :8770 times
  // out. main.js emits this once, shortly after launch.
  onEchoCoreStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('echo:core-status', handler);
    return () => ipcRenderer.removeListener('echo:core-status', handler);
  },

  // System-wide dictation + selection-read (electron/globalInput.js). These
  // are the app's first ipcRenderer.invoke calls — everything above this is
  // fire-and-forget (send) or a push subscription (on); accessibility
  // status, hotkey registration, and text injection all need an actual
  // return value, hence invoke/handle instead.
  getAccessibilityStatus: () => ipcRenderer.invoke('echo:get-accessibility-status'),
  requestAccessibilityPermission: () => ipcRenderer.invoke('echo:request-accessibility-permission'),
  registerHotkeys: (accelerators) => ipcRenderer.invoke('echo:register-hotkeys', accelerators),
  openAccessibilitySettings: () => ipcRenderer.send('echo:open-accessibility-settings'),
  relaunch: () => ipcRenderer.send('echo:relaunch'),
  injectText: (text) => ipcRenderer.invoke('echo:inject-text', text),

  // The renderer owns the actual dictation-active state machine (mic
  // capture, VAD, transcription all happen there — see
  // services/dictationService.ts); this just lets it push that state to
  // main so the Tray icon/menu can reflect it.
  setDictationActive: (active) => ipcRenderer.send('echo:dictation-state-changed', active),

  // Global hotkey fired (main process, works even when Echo isn't focused)
  // — the renderer decides what "toggle dictation" actually means.
  onDictationHotkey: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('echo:dictation-hotkey', handler);
    return () => ipcRenderer.removeListener('echo:dictation-hotkey', handler);
  },

  // Selection-read's captured text, pushed once main has grabbed it from
  // the OS clipboard and restored the user's original clipboard content.
  onSelectionCaptured: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('echo:selection-captured', handler);
    return () => ipcRenderer.removeListener('echo:selection-captured', handler);
  },
});
