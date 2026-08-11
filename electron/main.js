// electron/main.js — Echo desktop shell, main (Node) process.
//
// Responsibilities:
//   1. Open the app window and load the React UI (dev server or built dist/).
//   2. Grant microphone access — Echo is voice-first, and Electron blocks
//      getUserMedia by default unless a permission handler explicitly allows it.
//   3. Auto-start "Echo Core" (the separate terminal-brain daemon in
//      ../echo-core) as a background child process, so the user never has to
//      open a terminal and run it by hand.
//   4. Check for app updates via electron-updater / GitHub Releases.
//
// This file is intentionally the ONLY place with Node/OS access. The
// renderer (the existing React app) never gets nodeIntegration — see
// preload.js for the narrow, safe bridge it's given instead.

const { app, BrowserWindow, session, shell, ipcMain, desktopCapturer } = require('electron');
const path = require('node:path');
const { fork } = require('node:child_process');
const fs = require('node:fs');

// ---------------------------------------------------------------------------
// Live Meeting Mode: macOS system-audio loopback feature flags
// ---------------------------------------------------------------------------
//
// Must be set before app.whenReady() — Chromium reads command-line switches
// at startup, not on demand. This is what lets setDisplayMediaRequestHandler
// (below) request `audio: 'loopback'` and get REAL system-wide audio via
// ScreenCaptureKit on macOS 13+, rather than silence or a rejection.
//
// Verified hands-on this session, not assumed from docs: a standalone probe
// with this exact switch, on this exact machine (macOS 26.4.1, Electron
// 33.4.11), captured real spoken audio through the system speakers —
// RMS 0.137, peak 1.001, track labelled "System audio" by macOS itself, WAV
// round-tripped correctly. This is a big part of why the app needs
// "Screen & System Audio Recording" permission (System Settings > Privacy &
// Security) — Electron.app must be added there manually the first time;
// macOS does not always show an automatic prompt for a bare/dev Electron
// binary the way it does for camera/mic.
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Dev vs. prod load target. `npm run electron:dev` (see README) sets
// ELECTRON_DEV=1 and runs `vite` (port 3000) alongside this process, so we
// point the window at the live dev server with HMR. In a packaged build
// there is no dev server — we load the built dist/index.html straight off
// disk instead. Checking an explicit env var (rather than `app.isPackaged`)
// keeps this predictable if someone runs `electron .` unpackaged without
// also running vite.
const isDev = !!process.env.ELECTRON_DEV;

// Matches --bg-base in src/index.css / the Capacitor splash screen config
// (capacitor.config.ts). Setting this as the BrowserWindow backgroundColor
// avoids a flash of white while the renderer boots — important for a
// "Matrix terminal" themed app.
const BG_COLOR = '#010502';

let mainWindow = null;
let echoCoreProcess = null;
let lastCoreStatus = null; // replayed to the renderer once it's ready to listen (see notifyEchoCoreStatus)

// Set true only by the real quit paths below (Tray "Quit Echo", Cmd+Q,
// before-quit). Everywhere else, closing the window just hides it — see the
// 'close' handler in createWindow() for why: system-wide dictation
// (electron/globalInput.js) runs in the renderer, so destroying the window
// on a plain close would silently kill dictation the moment the user
// "closes" what looks like just a window, defeating the feature's entire
// premise of working while some OTHER app has focus.
let isQuitting = false;

// ---------------------------------------------------------------------------
// Echo Core (the separate terminal-brain daemon) — auto-start as a child
// process
// ---------------------------------------------------------------------------
//
// Echo Core (echo-core/echo.mjs) is a standalone Node/ESM program that runs
// a WebSocket sync hub on ws://127.0.0.1:8770 (see echo-core/sync.mjs) plus
// an optional static file server for dist/. The web app connects to it for
// terminal/filesystem-style access (services/echoCoreSync.ts). Today the
// user has to open a terminal and run `node echo.mjs` themselves — the whole
// point of an Electron shell is that its main process IS Node, so we can
// just fork the same entry point ourselves and skip that step entirely.
//
// ECHO_HEADLESS=1 is load-bearing here: without it, echo.mjs attaches a
// readline REPL to process.stdin. A forked child has no real TTY attached,
// so readline hits EOF almost immediately, which (per echo.mjs's own
// comments) used to call process.exit(0) and kill the whole server seconds
// after boot. ECHO_HEADLESS=1 skips the REPL and just keeps the HTTP/WS
// servers alive — exactly what we want running invisibly behind the window.
function startEchoCore() {
  // Packaged apps ship echo-core/ as an extraResource (see
  // electron-builder.yml) rather than inside the asar archive, because it's
  // a real Node program with its own node_modules that needs to run as a
  // normal child process — code inside asar can't be `fork()`ed directly.
  // process.resourcesPath only exists in a packaged app; in dev we just use
  // the repo's echo-core/ directory next to this one.
  const entry = app.isPackaged
    ? path.join(process.resourcesPath, 'echo-core', 'echo.mjs')
    : path.join(__dirname, '..', 'echo-core', 'echo.mjs');

  if (!fs.existsSync(entry)) {
    console.error(`[echo-core] entry point not found at ${entry} — skipping auto-start.`);
    console.error('[echo-core] Echo will still run, but terminal/filesystem features will be unavailable.');
    return;
  }

  try {
    echoCoreProcess = fork(entry, [], {
      cwd: path.dirname(entry),
      env: {
        ...process.env,
        ECHO_HEADLESS: '1',
      },
      // Pipe child stdio to our own logs (visible via Console.app / terminal
      // launch) instead of inheriting — keeps things tidy and lets us tag
      // lines with a prefix below.
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    echoCoreProcess.stdout?.on('data', (chunk) => {
      process.stdout.write(`[echo-core] ${chunk}`);
    });
    echoCoreProcess.stderr?.on('data', (chunk) => {
      process.stderr.write(`[echo-core] ${chunk}`);
    });

    echoCoreProcess.on('error', (err) => {
      // fork() itself failed (e.g. bad Node install in the packaged app).
      // Log and move on — Echo Core is a nice-to-have, not a hard dependency
      // of the app launching successfully.
      console.error('[echo-core] failed to start:', err);
      echoCoreProcess = null;
      notifyEchoCoreStatus('error', String(err));
    });

    echoCoreProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[echo-core] exited unexpectedly (code=${code}, signal=${signal})`);
      }
      echoCoreProcess = null;
      notifyEchoCoreStatus('stopped');
    });

    // We can't be 100% sure the WS/HTTP servers inside echo-core came up
    // successfully (that happens async inside its own main()), but a fork()
    // that didn't immediately error is a reasonable "started" signal for the
    // renderer's connection-status UI. echoCoreSync.ts (the renderer-side WS
    // client) still does its own retry/backoff against ws://127.0.0.1:8770
    // regardless of what we report here.
    notifyEchoCoreStatus('started');
  } catch (err) {
    // Belt-and-suspenders: fork() can throw synchronously in rare cases
    // (e.g. resource limits). Never let this take the whole app down.
    console.error('[echo-core] unexpected error starting child process:', err);
    echoCoreProcess = null;
    notifyEchoCoreStatus('error', String(err));
  }
}

// Push Echo Core's lifecycle status to the renderer (see preload.js's
// onEchoCoreStatus). We start Echo Core before the window/renderer exists
// (see app.whenReady below), so the very first status is almost always sent
// before anyone is listening — we stash it in lastCoreStatus and replay it
// once the page finishes loading (wired up in createWindow) so the UI can
// still show an accurate initial state instead of missing it.
function notifyEchoCoreStatus(state, detail) {
  lastCoreStatus = { state, detail };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('echo:core-status', lastCoreStatus);
  }
}

// Kill Echo Core cleanly so it never becomes an orphaned background process
// after the app quits. Called from every quit path below (window-all-closed
// on non-mac, before-quit everywhere) — cheap to call more than once since
// it no-ops if already gone.
function stopEchoCore() {
  if (echoCoreProcess && !echoCoreProcess.killed) {
    echoCoreProcess.kill();
    echoCoreProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Microphone permission
// ---------------------------------------------------------------------------
//
// Echo is a voice-first app — getUserMedia({ audio: true }) is on the
// critical path for basically everything it does. By default Electron's
// permission handler DENIES all permission requests from web content
// (unlike a real browser, which prompts the OS/user). If we don't install
// our own handler here, mic access fails silently: no popup, no obvious
// error, getUserMedia's promise just rejects with NotAllowedError and it's
// very easy to spend an hour debugging "why doesn't the mic work in the
// desktop build" before realizing this is the cause. This is the single
// most likely thing to silently break voice in an Electron wrapper, so it
// gets handled explicitly and up front rather than discovered later.
//
// Note this only covers the Electron-level content permission gate. The OS
// will still show its own native mic-access prompt (macOS Privacy &
// Security / Windows mic settings) the first time — that's expected and
// separate from this.
function setupMicPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
      return;
    }
    // Deny everything else by default (the app doesn't need camera,
    // geolocation, notifications-from-web, etc. — keep the surface minimal).
    callback(false);
  });

  // Some Electron/Chromium versions also consult this synchronous check
  // (e.g. for `navigator.permissions.query`) separately from the async
  // handler above — set both so mic status reads as "granted" consistently.
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media';
  });
}

// ---------------------------------------------------------------------------
// Live Meeting Mode: getDisplayMedia handler (system-audio loopback capture)
// ---------------------------------------------------------------------------
//
// Without this, Electron REJECTS every getDisplayMedia() call from the
// renderer outright — there is no default picker the way a real browser has
// one. This mirrors exactly what the standalone probe proved works: pick a
// screen source programmatically (no UI needed — this app wants "hear the
// whole system", not "let the user choose which window"), request
// `audio: 'loopback'` to get the real feature-flagged system-audio path
// rather than silence, and fail loudly into the callback (never hang) if no
// source is available so services/meetingCaptureService.ts's caller sees a
// real rejected promise instead of a stall.
function setupMeetingCaptureSupport() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (!sources.length) {
        console.error('[meeting-capture] no screen sources available from desktopCapturer — cannot fulfill getDisplayMedia.');
        callback({});
        return;
      }
      callback({ video: sources[0], audio: 'loopback' });
    }).catch((err) => {
      console.error('[meeting-capture] desktopCapturer.getSources failed (likely missing Screen & System Audio Recording permission):', err);
      callback({});
    });
  }, { useSystemPicker: false });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Echo',
    backgroundColor: BG_COLOR,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false, // wait for 'ready-to-show' to avoid a blank/white flash
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Replay the most recent Echo Core status once the page has actually
  // loaded and had a chance to register its onEchoCoreStatus listener —
  // startEchoCore() runs before this window even exists, so the renderer
  // would otherwise miss that first event entirely.
  mainWindow.webContents.on('did-finish-load', () => {
    if (lastCoreStatus) {
      mainWindow.webContents.send('echo:core-status', lastCoreStatus);
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Open any target="_blank" / window.open() links in the OS default
  // browser instead of a second Electron window — the app has no need for
  // a second chromeless window and this avoids it becoming a way to
  // navigate away from the app UI unexpectedly.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Echo is now a tray-resident app (like Slack/Raycast/1Password), not
  // because that's the default Electron pattern but because system-wide
  // dictation needs the renderer alive even when the user isn't looking at
  // the window — see the isQuitting comment above. The window's own red
  // close button / Cmd+W now HIDES it instead of destroying it; the app only
  // actually exits via the Tray menu's "Quit Echo", Cmd+Q, or the OS. This
  // is a deliberate, visible behavior change from a plain single-window app.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Answers preload.js's sendSync('echo:get-app-version') fallback (used when
// npm_package_version isn't set in the packaged app's environment, which is
// the normal case — that env var is an npm-run-script convenience, not
// something a launched .app has).
ipcMain.on('echo:get-app-version', (event) => {
  event.returnValue = app.getVersion();
});

app.whenReady().then(() => {
  setupMicPermissions();
  setupMeetingCaptureSupport();
  createWindow();
  startEchoCore();

  const { setupGlobalInput } = require('./globalInput');
  setupGlobalInput(() => mainWindow);

  // Manual update-check trigger from the renderer (e.g. a "Check for
  // Updates" button), independent of the automatic launch-time check below.
  const updater = require('./updater');
  ipcMain.on('echo:check-for-updates', () => {
    updater.checkForUpdates(() => mainWindow);
  });

  // Update check on launch — see updater.js for details, including the
  // dev-mode no-op guard (electron-updater throws if run unpackaged).
  try {
    updater.checkForUpdatesOnLaunch(() => mainWindow);
  } catch (err) {
    console.error('[updater] failed to initialize:', err);
  }

  // macOS convention: clicking the dock icon should bring the app forward.
  // Now that closing hides rather than destroys the window (see the 'close'
  // handler above), the common case here is an existing-but-hidden window
  // that just needs showing — createWindow() is only the fallback for the
  // rare case the window was genuinely destroyed (e.g. a crash/reload).
  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    } else {
      createWindow();
    }
  });
});

// macOS convention: apps stay running (visible in the dock) after the last
// window closes, until the user explicitly quits (Cmd+Q). Every other
// platform quits when the last window closes.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopEchoCore();
    app.quit();
  }
});

// Fires on every quit path (Cmd+Q, app.quit(), OS shutdown/logout, etc.) —
// the one place we can be sure to reach regardless of platform or how quit
// was triggered, so Echo Core never lingers as an orphaned process.
app.on('before-quit', () => {
  isQuitting = true; // let the window's 'close' handler know this is a real quit, not a hide-to-tray
  stopEchoCore();
});

// Extra safety net: if the main process itself is killed abruptly (e.g. via
// task manager) 'before-quit' may never fire. This won't catch a SIGKILL,
// but it does catch a plain SIGTERM/SIGINT, which covers most "close the
// app" paths that bypass the normal Electron quit sequence.
process.on('exit', stopEchoCore);
