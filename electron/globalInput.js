// electron/globalInput.js — System-wide dictation + selection-read.
//
// Everything that needs OS-level input simulation or a global (works when
// Echo isn't focused) hotkey lives here, kept separate from main.js's
// existing responsibilities (window, mic permission, meeting capture, Echo
// Core) the same way updater.js is its own file.
//
// Verified for real on this machine before any of this was written (Stage 0
// of the build): @nut-tree-fork/nut-js's prebuilt native binding loads
// inside Electron 33's process as installed by plain `npm install` — no
// electron-rebuild needed (it's an N-API/node-addon-api module, which is
// ABI-stable across Node/Electron versions by design, unlike classic native
// addons). Confirmed via a real probe: simulated Cmd+V genuinely typed text
// into a separate, real TextEdit window (read back independently via
// osascript), and simulated Cmd+A+Cmd+C genuinely overwrote the system
// clipboard with TextEdit's real selected content (proven with a decoy
// value first, so a stale-clipboard false positive was impossible). Both
// only worked once macOS Accessibility permission was granted to the
// Electron process — exactly the same TCC permission class as Screen
// Recording (see main.js's meeting-capture comment), but a distinct
// category that needs its own grant.
const { app, clipboard, globalShortcut, systemPreferences, shell, Tray, Menu, Notification, nativeImage, ipcMain } = require('electron');
const path = require('node:path');
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

// nut.js defaults to a small delay between simulated key events that's
// tuned for human-speed automation scripts, not "as fast as possible" —
// fine as-is, no override needed. Keep pressKey/releaseKey paired calls
// (not `keyboard.type()`, which "types" character-by-character and is the
// wrong tool for "send exactly this modifier combo once").
const MODIFIER = process.platform === 'darwin' ? Key.LeftSuper : Key.LeftControl;

const DEFAULT_ACCELERATORS = {
  dictation: 'CommandOrControl+Shift+D',
  selectionRead: 'CommandOrControl+Shift+R',
};

// Tracks exactly what's currently registered, so registerHotkeys() only ever
// unregisters ITS OWN two accelerators before re-registering — never a
// blanket globalShortcut.unregisterAll(), which could silently clobber a
// binding some other part of the app registers later.
let registeredAccelerators = { dictation: null, selectionRead: null };

let tray = null;
let dictationActiveForTray = false;

// ---------------------------------------------------------------------------
// Accessibility permission
// ---------------------------------------------------------------------------

// `prompt: false` just reads current status with no side effect (safe to
// call anytime, e.g. to render a settings-panel status line). `prompt: true`
// ALSO triggers the native macOS system prompt on first call — only call
// that from an explicit user action (a "Grant Permission" button), not on
// app boot, so the OS dialog doesn't ambush someone who hasn't asked for
// this feature yet. Every other platform has no equivalent explicit grant
// for standard input-simulation (Windows can't inject into elevated/
// Administrator windows, which has no fix here — that's a documented
// limitation, not a bug).
function checkAccessibility(prompt) {
  if (process.platform !== 'darwin') return true;
  try {
    return systemPreferences.isTrustedAccessibilityClient(!!prompt);
  } catch (e) {
    console.error('[globalInput] isTrustedAccessibilityClient failed:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Native automation (paste-injection, copy-capture)
// ---------------------------------------------------------------------------

async function simulatePaste() {
  await keyboard.pressKey(MODIFIER, Key.V);
  await keyboard.releaseKey(MODIFIER, Key.V);
}

async function simulateSelectAllCopy() {
  await keyboard.pressKey(MODIFIER, Key.A);
  await keyboard.releaseKey(MODIFIER, Key.A);
  await new Promise((r) => setTimeout(r, 100));
  await keyboard.pressKey(MODIFIER, Key.C);
  await keyboard.releaseKey(MODIFIER, Key.C);
}

async function simulateCopy() {
  await keyboard.pressKey(MODIFIER, Key.C);
  await keyboard.releaseKey(MODIFIER, Key.C);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Pastes `text` into whatever field currently has OS focus (which app that
// is is entirely up to the user — this fires in direct response to their
// own hotkey press or explicit dictation utterance, never autonomously).
// Clipboard-write-then-paste, not char-by-char keystroke simulation — more
// reliable, avoids autocomplete/autocorrect/IME interference, and is what
// every real dictation tool does under the hood. Always restores the user's
// original clipboard content afterward, even on failure (try/finally) — an
// injection feature that silently clobbers your clipboard on the way past
// is a worse bug than the feature not working at all.
async function injectText(text) {
  if (!checkAccessibility(false)) {
    return { ok: false, error: 'Accessibility permission is not granted.' };
  }
  const previousClipboard = clipboard.readText();
  try {
    clipboard.writeText(text);
    await sleep(50); // let the OS-level clipboard write settle before the paste reads it
    await simulatePaste();
    // Long enough for the simulated paste to have actually READ the new
    // clipboard content before we overwrite it again below — restoring too
    // eagerly is a real race, not a hypothetical one.
    await sleep(200);
    return { ok: true };
  } catch (e) {
    console.error('[globalInput] injectText failed:', e);
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    try { clipboard.writeText(previousClipboard); } catch { /* ignore */ }
  }
}

// Grabs whatever's currently selected in the focused app. Detects "nothing
// was actually selected" by comparing against the pre-copy clipboard value
// (if the copy didn't change anything, either nothing was selected or the
// selection WAS literally the clipboard's existing content — the former is
// far more common, and either way there's nothing new to hand off).
async function captureSelection() {
  if (!checkAccessibility(false)) {
    return { ok: false, error: 'Accessibility permission is not granted.' };
  }
  const previousClipboard = clipboard.readText();
  // A decoy first — mirrors the Stage 0 probe's own verification technique.
  // Without this, a copy that silently does nothing (e.g. focus was on a
  // non-text element) would just leave the OLD clipboard content in place,
  // which reads identically to "there was nothing new to capture" — correct
  // either way — but writing a decoy first means a genuine copy is the only
  // way the final read can differ from the decoy, which is a stronger
  // signal when reasoning about failures during development/debugging.
  try {
    clipboard.writeText('__echo_selection_probe__');
    await sleep(50);
    await simulateCopy();
    await sleep(250);
    const captured = clipboard.readText();
    const nothingNewSelected = captured === '__echo_selection_probe__';
    return { ok: true, text: nothingNewSelected ? '' : captured };
  } catch (e) {
    console.error('[globalInput] captureSelection failed:', e);
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    try { clipboard.writeText(previousClipboard); } catch { /* ignore */ }
  }
}

// Shared by both the global hotkey and the Tray menu's "Read Selection"
// item — same behavior either way: capture, then bring Echo's window
// forward and hand the text to the renderer's chat pre-fill.
async function performSelectionRead(getMainWindow) {
  const result = await captureSelection();
  const win = getMainWindow();
  if (!result.ok) {
    if (Notification.isSupported()) {
      new Notification({ title: 'Echo', body: `Couldn't read selection: ${result.error}` }).show();
    }
    return;
  }
  if (!result.text) {
    if (Notification.isSupported()) {
      new Notification({ title: 'Echo', body: 'Nothing was selected.' }).show();
    }
    return;
  }
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    win.webContents.send('echo:selection-captured', { text: result.text });
  }
}

// ---------------------------------------------------------------------------
// Global hotkeys
// ---------------------------------------------------------------------------

// Registers exactly two accelerators, tracking what was actually bound so a
// later call only ever touches these two (never globalShortcut.unregisterAll,
// which would be a blast-radius risk if anything else in the app ever
// registers its own global shortcut). Returns per-key success — one binding
// can fail (e.g. already claimed by another app) while the other succeeds;
// the caller (Settings UI) needs to know which.
function registerHotkeys(getMainWindow, { dictation, selectionRead } = {}) {
  const next = {
    dictation: dictation || DEFAULT_ACCELERATORS.dictation,
    selectionRead: selectionRead || DEFAULT_ACCELERATORS.selectionRead,
  };

  if (registeredAccelerators.dictation) {
    globalShortcut.unregister(registeredAccelerators.dictation);
    registeredAccelerators.dictation = null;
  }
  if (registeredAccelerators.selectionRead) {
    globalShortcut.unregister(registeredAccelerators.selectionRead);
    registeredAccelerators.selectionRead = null;
  }

  const result = { dictation: false, selectionRead: false };

  result.dictation = globalShortcut.register(next.dictation, () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('echo:dictation-hotkey');
    }
  });
  if (result.dictation) registeredAccelerators.dictation = next.dictation;

  result.selectionRead = globalShortcut.register(next.selectionRead, () => {
    void performSelectionRead(getMainWindow);
  });
  if (result.selectionRead) registeredAccelerators.selectionRead = next.selectionRead;

  return result;
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

// A real designed monochrome template icon can replace this later — using
// the existing app icon (resized) is a functional placeholder, not a
// polished final asset, and deliberately not marked as a template image
// (setTemplateImage) since it isn't actually monochrome, which would look
// wrong on macOS's automatic light/dark menu-bar tinting.
function loadTrayIcon() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  const img = nativeImage.createFromPath(iconPath);
  return img.resize({ width: 18, height: 18 });
}

function setupTray(getMainWindow, getDictationActive) {
  // Tray must be kept at module scope — if the local variable holding it
  // gets garbage-collected, the icon silently disappears from the menu bar.
  tray = new Tray(loadTrayIcon());
  tray.setToolTip('Echo');

  const rebuildMenu = () => {
    const accessibilityOk = checkAccessibility(false);
    const menu = Menu.buildFromTemplate([
      {
        label: getDictationActive() ? 'Stop Dictation' : 'Start Dictation',
        click: () => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('echo:dictation-hotkey');
        },
      },
      {
        label: 'Read Selection',
        click: () => { void performSelectionRead(getMainWindow); },
      },
      { type: 'separator' },
      {
        label: 'Open Echo',
        click: () => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) { win.show(); win.focus(); }
        },
      },
      {
        label: accessibilityOk ? 'Accessibility: Granted' : 'Accessibility: Not Granted (click to open Settings)',
        enabled: !accessibilityOk,
        click: () => {
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        },
      },
      { type: 'separator' },
      {
        // main.js's 'before-quit' handler sets the module-scoped isQuitting
        // flag that its window 'close' handler checks — app.quit() alone is
        // enough to trigger that; no property needs setting here.
        label: 'Quit Echo',
        click: () => app.quit(),
      },
    ]);
    tray.setContextMenu(menu);
  };

  rebuildMenu();
  tray.on('click', rebuildMenu); // refresh accessibility status each time it's opened
  return { rebuildMenu };
}

// Small text badge next to the tray icon (macOS supports Tray#setTitle;
// no-op elsewhere) — a pragmatic "is dictation on" indicator that needs no
// new designed icon assets. A red dot, not a word, to stay compact.
function updateTrayIndicator(active) {
  dictationActiveForTray = active;
  if (!tray) return;
  try {
    if (typeof tray.setTitle === 'function') {
      tray.setTitle(active ? '●' : '');
    }
  } catch { /* not supported on this platform, ignore */ }
}

// ---------------------------------------------------------------------------
// Setup entry point — mirrors main.js's setupMicPermissions()/
// setupMeetingCaptureSupport() call style.
// ---------------------------------------------------------------------------

function setupGlobalInput(getMainWindow) {
  registerHotkeys(getMainWindow, DEFAULT_ACCELERATORS);
  const { rebuildMenu } = setupTray(getMainWindow, () => dictationActiveForTray);

  ipcMain.handle('echo:get-accessibility-status', () => ({ granted: checkAccessibility(false) }));

  ipcMain.handle('echo:request-accessibility-permission', () => {
    // Triggers the native OS prompt on first call. Well-known macOS quirk:
    // once granted via System Settings, the app typically needs a RESTART
    // for the grant to actually take effect for THIS process — the renderer
    // surfaces that as UI copy, this just does the check/prompt itself.
    const granted = checkAccessibility(true);
    return { granted };
  });

  ipcMain.handle('echo:register-hotkeys', (_event, accelerators) => {
    const result = registerHotkeys(getMainWindow, accelerators || {});
    return result;
  });

  ipcMain.handle('echo:inject-text', async (_event, text) => {
    if (typeof text !== 'string' || !text) return { ok: false, error: 'No text provided.' };
    return injectText(text);
  });

  ipcMain.on('echo:dictation-state-changed', (_event, active) => {
    updateTrayIndicator(!!active);
    rebuildMenu();
  });

  ipcMain.on('echo:open-accessibility-settings', () => {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });

  ipcMain.on('echo:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });
}

module.exports = {
  setupGlobalInput,
  checkAccessibility,
  DEFAULT_ACCELERATORS,
};
