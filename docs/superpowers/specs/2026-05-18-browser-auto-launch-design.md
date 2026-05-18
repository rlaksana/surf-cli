# Browser Auto-Launch Design

## Context

surf-cli requires a browser with the surf extension to be running before use. Currently, if the browser is not running, the user receives an error message suggesting they run `surf tab.new` — but this still requires manual browser launch. Users want surf-cli to automatically launch the configured browser when it detects the browser is not running.

## Overview

When surf-cli (via `host.cjs`) cannot connect to the surf socket or the extension is not ready, it will:
1. Launch the configured browser in background mode
2. Wait for the surf extension to be ready (via PING/PONG handshake)
3. Execute the original request

**Key design decisions (addressing Codex review):**
- Extension readiness is the source of truth — NOT process existence
- An existing browser process does NOT suppress auto-launch if the extension is not connected
- Socket availability alone is insufficient; we require a PING/PONG round-trip to confirm the extension is ready

## Data Storage

### Config File: `~/.surf/surf.json`

```json
{
  "browserType": "msedge",
  "browserPath": "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
}
```

- `browserType`: Process name without `.exe` (e.g., `msedge`, `chrome`, `brave`)
- `browserPath`: Optional. If not set, derived from system PATH or registry.

## Components

### 1. Config Update: `install-native-host.cjs`

**Change**: Add `--browser` flag to install command.

```bash
npm run install:native -- --id <ext-id> --browser edge
```

- Validate browser name against supported list: `msedge`, `chrome`, `chromium`, `brave`, `arc`, `helium`
- Store `browserType` in `~/.surf/surf.json`
- Store `browserPath` (resolved executable path) in `~/.surf/surf.json`

### 2. Browser Launcher: Inline in `host.cjs`

**Location**: `host.cjs` — new helper functions added near socket setup.

#### `launchBrowser(browserType, browserPath)` → `Promise<void>`
- On Windows: `Start-Process <browserPath> -WindowStyle Hidden`
- On macOS: `open -a "<BrowserName>"`
- On Linux: `<browserPath> --new-window &`
- Does NOT wait for browser to fully start — returns immediately

#### `isExtensionReady(socketPath)` → `Promise<boolean>`
- Attempts to connect to the socket
- Sends a PING message to the extension
- Returns `true` if PONG is received within 2 seconds
- Returns `false` if socket unavailable, connection refused, or no PONG response
- **This replaces simple socket-polling as the readiness signal**

#### `waitForExtensionReady(socketPath, timeoutMs)` → `Promise<void>`
- Polls `isExtensionReady()` every 500ms
- Resolves when PING/PONG round-trip succeeds (extension is ready)
- Rejects with timeout error after `timeoutMs` (default: 30000ms)
- On each poll: if socket doesn't exist (ENOENT), do NOT treat as ready

#### `ensureBrowserAndSocket()` → `Promise<void>`
Orchestrates the full flow:
1. Read `browserType` from config
2. Check `isExtensionReady(socketPath)`
3. If not ready → `launchBrowser()`
4. `waitForExtensionReady(socketPath)` — waits for PING/PONG success
5. If timeout → reject with clear error

**Note:** We do NOT check process existence before launching. An existing browser process may not have the surf extension installed/connected. The extension readiness probe is the only reliable signal.

### 3. Socket Error Handling in `host.cjs`

**Existing behavior**: Socket errors (ENOENT, ECONNREFUSED) are caught and result in error messages.

**New behavior**: Instead of immediately failing, call `ensureBrowserAndSocket()`, then retry the original operation.

```javascript
// Before (conceptual):
socket.on('error', (err) => {
  if (err.code === 'ENOENT') {
    reject(new Error('Socket not found...'));
  }
});

// After (conceptual):
socket.on('error', async (err) => {
  if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
    try {
      await ensureBrowserAndSocket(socketPath);
      // Retry original operation
      return retryOriginalRequest();
    } catch (e) {
      reject(e);
    }
  }
});
```

## Flow Diagram

```
CLI Request
    │
    ▼
host.cjs: handleToolRequest()
    │
    ▼
Try socket connect ──── Success ────▶ Execute tool
    │
    │ ENOENT / ECONNREFUSED / Extension not ready
    ▼
ensureBrowserAndSocket()
    │
    ├─── Read config (browserType)
    │
    ▼
isExtensionReady(socket)?
    │
    ├─── YES ────▶ Execute tool (no launch needed)
    │
    │ NO
    ▼
launchBrowser()  ←── always launch if extension not ready
    │
    ▼
waitForExtensionReady(timeout=30s)
    │
    │ PING/PONG success
    ▼
Execute tool
    │
    | Timeout (30s)
    ▼
Error: "Browser launched but extension failed to connect.
Try running 'surf tab.new' manually."
```

**Key change from v1:** No process existence check. We launch whenever the extension is not ready, regardless of whether a browser process exists. This handles the case where Edge is running without the surf extension.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Config missing `browserType` | Skip auto-launch, show current error message |
| Browser not found in PATH/Registry | Error with install hint |
| Launch fails | Error: "Failed to launch <browser>. Is it installed?" |
| Extension ready timeout (30s) | Error: "Browser launched but extension failed to connect. Try running 'surf tab.new' manually." |
| PING/PONG fails repeatedly | After 3 consecutive PING failures, attempt re-launch (in case wrong browser profile was launched) |
| Config missing but socket eventually connects | Proceed normally |

## Testing Approach

1. **Unit tests** for `launchBrowser()` with mocked child_process
2. **Unit tests** for `isExtensionReady()` with mocked socket connection
3. **Integration test**: Kill browser, run surf command, verify auto-launch works
4. **Manual verification**: Kill browser, run `surf tab.list`, observe Edge launches automatically

## Files Changed

- `scripts/install-native-host.cjs` — add `--browser` flag, save to config
- `native/host.cjs` — add `launchBrowser`, `isExtensionReady`, `waitForExtensionReady`, `ensureBrowserAndSocket`
- `native/config.cjs` — ensure `getBrowserConfig()` reads from surf.json

## Security Considerations

- Browser path should be validated to prevent arbitrary command injection
- Only launch browsers from trusted paths (Program Files, etc.)
- Do not expose browser path in error messages that could reveal system info
- PING/PONG handshake prevents race condition where we retry before extension is ready

## Open Questions

1. Should we support `--no-auto-launch` flag to disable this behavior?
2. Should the launch be visible (WindowStyle Normal) instead of hidden on first launch?
3. Should we warn user that auto-launch will happen?
