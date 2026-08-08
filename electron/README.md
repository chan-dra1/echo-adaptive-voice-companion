# Echo Desktop (Electron shell)

This directory wraps the existing Echo web app (`dist/`, built by Vite) in
an Electron shell, and auto-starts **Echo Core** (`../echo-core/echo.mjs`,
the separate terminal-brain daemon) as a background child process so the
user never has to open a terminal.

Files:

- `main.js` — main (Node) process: window creation, mic permission grant,
  Echo Core auto-start/stop, update-check wiring.
- `preload.js` — the only bridge into the renderer, via `contextBridge`.
  Exposes `window.echoDesktop` (`platform`, `appVersion`,
  `checkForUpdates()`, `onUpdateStatus()`, `onEchoCoreStatus()`). No raw
  `ipcRenderer`, no Node, nothing else — `contextIsolation: true` /
  `nodeIntegration: false` / `sandbox: true` on the `BrowserWindow`.
- `updater.js` — `electron-updater` wiring against GitHub Releases.
- `build/icon.icns` / `build/icon.png` — generated from `public/logo512.png`
  (1024×1024) via `sips` + `iconutil` (both macOS built-ins, no extra
  tooling installed).
- `build/entitlements.mac.plist` — hardened-runtime entitlements (mic +
  network access) needed once the app is code-signed.

The root-level `electron-builder.yml` (not in this directory, since
electron-builder expects it at the repo root) has the packaging config,
including the **Echo Core `extraResources` block** — see the comment in
that file for why it's there and what breaks if it's missing.

## Required `package.json` changes

This session did **not** touch `package.json` (per its constraints — the
main session owns that file). Here's exactly what needs to be added:

```jsonc
{
  // ...existing fields unchanged...

  // Electron's entry point. Required for `electron .` / `npx electron .` to
  // find main.js. Does NOT affect `npm run dev` / `vite build` at all — Vite
  // ignores this field.
  "main": "electron/main.js",

  "scripts": {
    // ...existing scripts unchanged...

    // Runs the app shell against the Vite dev server (with HMR) instead of
    // a built dist/. Needs BOTH the dev server and Electron running — the
    // `&&`/concurrently pattern below starts vite, waits for port 3000,
    // then launches Electron pointed at it via ELECTRON_DEV=1 (see
    // electron/main.js's `isDev` check). `wait-on` and `concurrently` are
    // small, common dev-only deps for exactly this pattern.
    "electron:dev": "concurrently -k \"vite\" \"wait-on tcp:3000 && cross-env ELECTRON_DEV=1 electron .\"",

    // Production smoke test: build the web app, then launch Electron
    // against the resulting dist/ (no dev server, no ELECTRON_DEV env var —
    // matches exactly what a packaged app will load).
    "electron:preview": "vite build && electron .",

    // Build installers for the current platform only, no publish. Good for
    // local testing before cutting a real release.
    "electron:build": "vite build && electron-builder",

    // Full release: build the web app, build installers for mac (dmg+zip,
    // arm64+x64) and win (nsis), and upload them + the update manifest to
    // GitHub Releases. Needs a GH_TOKEN env var (see "Publishing a release"
    // below). This is what actually ships an update to installed users.
    "electron:publish": "vite build && electron-builder --publish always"
  },

  "devDependencies": {
    // ...existing devDependencies unchanged...

    // Pin to whatever's current/stable at install time; versions below are
    // reasonable pins as of when this was written, bump freely.
    "electron": "^33.0.0",
    "electron-builder": "^25.1.8",
    "concurrently": "^9.1.0",
    "wait-on": "^8.0.1",
    "cross-env": "^7.0.3"
  },

  "dependencies": {
    // electron-updater must be a regular dependency (not dev), since it
    // runs inside the PACKAGED app at runtime, not just during the build —
    // electron-builder itself is fine as a devDependency because only the
    // build machine needs it.
    "electron-updater": "^6.3.9"
  }
}
```

Run `npm install` after merging these in (this session deliberately did
**not** run it, per instructions, to avoid clobbering a concurrent install).

## Running in dev

```sh
npm run electron:dev
```

This starts the Vite dev server (port 3000, with HMR) and an Electron
window pointed at it. DevTools open automatically in dev
(`webContents.openDevTools({ mode: 'detach' })` in `main.js`). Echo Core
still auto-starts from the *source* `echo-core/echo.mjs` next to `electron/`
(not a packaged copy — see `main.js`'s `startEchoCore()`, which branches on
`app.isPackaged`).

## Building installers locally (no publish)

```sh
npm run electron:build
```

Outputs to `release/<version>/` — a `.dmg` and `.zip` for both `arm64` and
`x64` on macOS (Apple Silicon and Intel), an NSIS `.exe` installer on
Windows (only the platform you're currently on gets built unless you set up
cross-platform build tooling — building Windows installers on macOS needs
Wine, which isn't assumed here).

**Code signing / notarization is NOT set up.** `electron-builder.yml` sets
`mac.hardenedRuntime: true` and points at
`electron/build/entitlements.mac.plist`, which is what a signed build
needs — but without an Apple Developer account's certificate (`CSC_LINK` +
`CSC_KEY_PASSWORD` env vars, or a signing identity in the local macOS
Keychain), electron-builder will produce an **unsigned** build. Unsigned
builds run fine on the machine that built them, but macOS Gatekeeper will
show a scary warning ("Echo can't be opened because Apple cannot check it
for malicious software") on any other machine until you either right-click
→ Open once, or set up real signing + notarization. That's an Apple
Developer Program enrollment ($99/yr) the user needs to do themselves — not
something automatable here.

## Publishing a release (how updates actually ship)

Auto-update is wired via `electron-updater` against GitHub Releases on
`chan-dra1/echo-adaptive-voice-companion` (see `electron-builder.yml`'s
`publish` block and `electron/updater.js`). End-to-end flow:

1. **Bump the version.** Edit `package.json`'s `"version"` field (semver,
   e.g. `0.0.0` → `0.1.0`). electron-builder reads this to tag the release
   and to write the version into the generated update manifest
   (`latest.yml` / `latest-mac.yml`) that installed apps compare against.
   This is the single source of truth for "is there a newer version" — if
   you forget to bump it, `electron-builder --publish` will still build and
   publish, but existing installs won't see it as an update.

2. **Get a GitHub token.** Create a personal access token with `repo` scope
   (classic) or equivalent fine-grained permissions on this repo, and
   export it:
   ```sh
   export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   ```
   `electron-builder` picks this up automatically — it's how it
   authenticates to create the GitHub Release and upload assets.

3. **Build and publish:**
   ```sh
   npm run electron:publish
   ```
   This builds the web app, builds installers for all configured targets,
   creates (or reuses) a GitHub Release tagged `v<version>`, and uploads the
   installers plus the update manifest to it. By default electron-builder
   publishes the release as a **draft** unless you mark it otherwise — check
   the repo's Releases page and publish the draft (or pass
   `--publish always` as done above, which publishes it live immediately;
   use `--publish onTagOrDraft` instead if you want to review before it goes
   out).

4. **Installed apps update themselves.** Every launch, `main.js` calls
   `updater.checkForUpdatesOnLaunch()`, which asks GitHub for the latest
   release manifest, compares its version against the running app's
   (`app.getVersion()`, from `package.json`'s `version` at build time), and
   if newer: downloads the new installer in the background
   (`autoUpdater.autoDownload = true`) and fires `update-downloaded`. The
   renderer gets an `echo:update-status` IPC event
   (`{ status: 'downloaded', detail: version }`) via
   `window.echoDesktop.onUpdateStatus()` and can show a "restart to update"
   prompt. Either way, `autoInstallOnAppQuit = true` means it applies
   automatically the next time the app quits and relaunches, even if the
   user ignores the prompt.

5. **Dev builds never call GitHub.** `updater.js` checks `app.isPackaged`
   before doing anything — `npm run electron:dev` / `electron:preview` are
   unpackaged runs, so the update check no-ops immediately (logs
   `[updater] skipped (not a packaged build)`). This matters because
   `electron-updater` **throws synchronously** if you call
   `autoUpdater.checkForUpdates()` in an app that wasn't built with
   electron-builder (it looks for packaging metadata — `app-update.yml` —
   that only exists in a real build). Without this guard, every dev launch
   would crash on startup.

## Notes / assumptions worth double-checking

- **Icons**: `electron/build/icon.icns` was generated from
  `public/logo512.png` using `sips` + `iconutil` (both macOS built-ins).
  `public/logo512.png` is actually a 1024×1024 image despite its filename
  (confirmed via `sips -g pixelWidth -g pixelHeight`) — good, that's the
  size macOS wants for the largest icns representation. There's no
  first-class way to build a multi-resolution Windows `.ico` from a macOS
  CLI without extra tooling (ImageMagick wasn't installed in this
  environment), so `win.icon` points at `electron/build/icon.png` instead —
  electron-builder auto-generates an `.ico` from a single 1024×1024 PNG at
  build time when no platform-specific `icon.ico` is supplied. If you'd
  rather ship a hand-tuned `.ico` (e.g. for crisper small sizes), generate
  one with ImageMagick or an online tool and drop it at
  `electron/build/icon.ico` — electron-builder will prefer it automatically.
- **Echo Core auto-start**: confirmed by reading `echo-core/echo.mjs`
  directly rather than guessing — `ECHO_HEADLESS=1` is a real, documented
  env var in that file specifically for this scenario (no TTY attached);
  without it, `readline` hits EOF immediately and the process used to exit.
  The sync hub's default port (8770) matches what
  `services/echoCoreSync.ts` already expects (`ws://127.0.0.1:8770`), so no
  port configuration was needed on either side.
- **Not verified — could not launch the app** (no display in this
  environment, and instructed not to try): whether the BrowserWindow
  actually renders correctly, whether `getUserMedia` truly succeeds end to
  end with the permission handler, whether Echo Core's child process
  actually reaches a healthy WS-serving state before the renderer tries to
  connect, and whether the packaged `extraResources` Echo Core copy
  actually runs correctly (its `node_modules/ws` needs to be present and
  compatible with the Node/ABI Electron embeds — pure-JS `ws` has no native
  bindings, so this should be safe, but it's untested here). Please smoke
  test `npm run electron:dev` and a local `npm run electron:build` install
  once dependencies are in place.
- **`sandbox: true`** is set on the `BrowserWindow` in `main.js` for
  defense in depth. If the renderer needs a Node/Electron API that sandbox
  mode blocks preload from using directly (sandboxed preloads have a
  restricted module set), that would need addressing in `preload.js` — the
  current preload only uses `ipcRenderer` and `process.platform`/`process.env`,
  both of which are available under `sandbox: true`.
