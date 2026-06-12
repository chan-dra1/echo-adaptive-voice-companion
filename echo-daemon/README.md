# Echo Hands — Local Execution Daemon

Gives the Echo PWA real "hands" on this machine: shell commands, file
read/write, directory listing. The browser sandbox can't do any of this,
so Echo connects to this daemon over a **localhost-only** WebSocket.
On devices without the daemon (e.g. your phone), Echo simply runs
API-only — same brain, hands when available.

## Setup (one time)

```bash
cd echo-daemon
npm install
npm start
```

The daemon prints a **pairing token**. In Echo, press **⌘K → "Connect
Echo Hands"** and paste it. Echo auto-reconnects on every launch after
that.

## What Echo can do once paired

| Tool | What it does | Confirmation? |
|---|---|---|
| `hands_run_command` | Run a zsh command | Yes, unless read-only (ls/cat/grep/git status…) |
| `hands_read_file` | Read a text file | No |
| `hands_write_file` | Write/append a file | Always |
| `hands_list_files` | List a directory | No |
| `hands_system_info` | OS / memory / hostname | No |

## Security model

- Binds to `127.0.0.1` only — never reachable from the network.
- Random 48-char token, stored at `~/.echo-hands/token` (mode 600).
- Hard denylist: `sudo`, `rm -rf /`, `mkfs`, `dd of=/dev/...`, fork
  bombs, shutdown/reboot, disk erasure.
- File operations are jailed to `$HOME` (override with `EH_WORKSPACE=/path`).
- 60s command timeout, 200 KB output cap.
- Destructive actions additionally require a click-through confirmation
  in the Echo UI before the request is even sent.

## Config

| Env var | Default | Meaning |
|---|---|---|
| `EH_PORT` | `8765` | WebSocket port |
| `EH_WORKSPACE` | `$HOME` | Root jail for file ops & cwd |

## Run at login (macOS, optional)

```bash
cat > ~/Library/LaunchAgents/com.echo.hands.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.echo.hands</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>__REPLACE_WITH_ABSOLUTE_PATH__/echo-daemon/server.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
EOF
launchctl load ~/Library/LaunchAgents/com.echo.hands.plist
```
