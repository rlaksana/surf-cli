# Browser Auto-Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When surf CLI cannot connect to the surf socket (browser not running), automatically launch the configured browser and wait for the extension to connect before retrying the request.

**Architecture:** The auto-launch logic lives in `cli.cjs` (where socket connection errors occur). A new `browser-launcher.cjs` module handles browser launching and extension readiness probing. The install script saves browser config to `surf.json`.

**Tech Stack:** Node.js child_process for launching, net.Socket for probe via `tab.list` command, surf.json for config persistence

---

## File Structure

```
native/
  browser-launcher.cjs      # NEW: Browser launching + extension readiness
  cli.cjs                   # MODIFY: Socket error handler → auto-launch
  config.cjs               # MODIFY: Add getBrowserConfig()

scripts/
  install-native-host.cjs    # MODIFY: Add --browser flag → save to config
```

---

## Task 1: Add `getBrowserConfig()` to config.cjs

**Files:**
- Modify: `native/config.cjs`

Add a function to read browser config from surf.json.

- [ ] **Step 1: Add browser config getter**

Find `module.exports` in `native/config.cjs` (line ~110) and add before it:

```javascript
function getBrowserConfig() {
  const config = loadConfig();
  return {
    browserType: config.browserType || null,
    browserPath: config.browserPath || null,
  };
}
```

- [ ] **Step 2: Export the new function**

Add `getBrowserConfig` to the `module.exports` object:

```javascript
module.exports = {
  loadConfig,
  getConfigPath,
  createStarterConfig,
  clearCache,
  getBrowserConfig,
  STARTER_CONFIG,
  COUNCIL_CONFIG,
};
```

- [ ] **Step 3: Commit**

```bash
git add native/config.cjs
git commit -m "feat(config): add getBrowserConfig() for browser auto-launch"
```

---

## Task 2: Create `browser-launcher.cjs`

**Files:**
- Create: `native/browser-launcher.cjs`

This module handles launching the browser and checking if the extension is ready.

- [ ] **Step 1: Write the module**

Create `native/browser-launcher.cjs` with this content:

```javascript
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const os = require("os");
const { getBrowserConfig } = require("./config.cjs");

const IS_WIN = process.platform === "win32";
const SOCKET_PATH = IS_WIN ? "//./pipe/surf" : "/tmp/surf.sock";

const BROWSER_PATHS = {
  msedge: IS_WIN
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  chrome: IS_WIN
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  chromium: IS_WIN
    ? "C:\\Program Files\\Chromium\\Application\\chrome.exe"
    : "/Applications/Chromium.app/Contents/MacOS/Chromium",
  brave: IS_WIN
    ? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
    : "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  arc: IS_WIN
    ? "C:\\Users\\Richard\\AppData\\Local\\Arc\\Application\\arc.exe"
    : "/Applications/Arc.app/Contents/MacOS/Arc",
  helium: IS_WIN
    ? "C:\\Program Files\\Helium\\helium.exe"
    : "/Applications/Helium.app/Contents/MacOS/Helium",
};

/**
 * Launch browser in background mode (hidden window)
 * @param {string} browserType - e.g., "msedge", "chrome"
 * @param {string} [browserPath] - optional explicit path
 */
function launchBrowser(browserType, browserPath) {
  const execPath = browserPath || BROWSER_PATHS[browserType];

  if (!execPath) {
    throw new Error(`Unknown browser type: ${browserType}`);
  }

  if (IS_WIN) {
    // Windows: use Start-Process for hidden window via spawn (safer than execSync)
    spawn("powershell", [
      "-Command",
      "Start-Process",
      "-FilePath", execPath,
      "-WindowStyle", "Hidden"
    ], { stdio: "ignore", detached: true });
  } else if (process.platform === "darwin") {
    // macOS: use open command
    spawn("open", ["-a", execPath], { detached: true, stdio: "ignore" });
  } else {
    // Linux: launch in background
    spawn(execPath, ["--new-window"], { detached: true, stdio: "ignore" });
  }
}

/**
 * Check if the surf extension is ready by sending a lightweight `tab.list` request
 * and verifying we get a valid structured response.
 * @param {number} timeoutMs - timeout for the check
 * @returns {Promise<boolean>}
 */
function isExtensionReady(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let resolved = false;
    const startTime = Date.now();

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try { sock.destroy(); } catch {}
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    sock.on("connect", () => {
      // Send a lightweight tab.list probe
      const req = {
        type: "tool_request",
        method: "execute_tool",
        params: { tool: "tab.list", args: {} },
        id: `probe-${Date.now()}`,
      };

      try {
        sock.write(JSON.stringify(req) + "\n");
      } catch {
        cleanup();
        clearTimeout(timer);
        resolve(false);
        return;
      }

      let data = "";
      const responseHandler = (chunk) => {
        data += chunk.toString();
        // Parse responses as they arrive (may come as multiple JSON lines)
        const lines = data.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.id === req.id && msg.result !== undefined) {
              // Valid structured response received
              sock.removeListener("data", responseHandler);
              cleanup();
              clearTimeout(timer);
              resolve(true);
              return;
            }
            if (msg.type === "error" || (msg.error && msg.error.code)) {
              // Error response means extension is connected (even if error)
              sock.removeListener("data", responseHandler);
              cleanup();
              clearTimeout(timer);
              resolve(true);
              return;
            }
          } catch {
            // Not JSON yet, continue accumulating
          }
        }
      };

      sock.on("data", responseHandler);

      sock.on("error", () => {
        sock.removeListener("data", responseHandler);
        cleanup();
        clearTimeout(timer);
        resolve(false);
      });
    });

    sock.on("error", () => {
      cleanup();
      clearTimeout(timer);
      resolve(false);
    });

    sock.connect(SOCKET_PATH);
  });
}

/**
 * Wait for extension to be ready
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function waitForExtensionReady(timeoutMs = 30000) {
  const interval = 500;
  const maxAttempts = Math.floor(timeoutMs / interval);
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  for (let i = 0; i < maxAttempts; i++) {
    const ready = await isExtensionReady(2000);
    if (ready) {
      return;
    }

    consecutiveFailures++;
    // After 3 consecutive failures, suggest re-launch might help
    if (consecutiveFailures === MAX_CONSECUTIVE_FAILURES) {
      console.error("Extension not responding, will retry...");
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(
    "Browser launched but extension failed to connect. Try running 'surf tab.new' manually."
  );
}

/**
 * Ensure browser is running and extension is ready
 * @returns {Promise<void>}
 */
async function ensureBrowserAndSocket() {
  const { browserType, browserPath } = getBrowserConfig();

  if (!browserType) {
    throw new Error(
      "Browser not configured. Run: npm run install:native -- --id <ext-id> --browser edge"
    );
  }

  // Check if already ready
  if (await isExtensionReady(1000)) {
    return; // Already connected
  }

  // Launch browser
  console.error(`Launching ${browserType}...`);
  launchBrowser(browserType, browserPath);

  // Wait for extension to connect
  await waitForExtensionReady(30000);
}

module.exports = {
  launchBrowser,
  isExtensionReady,
  waitForExtensionReady,
  ensureBrowserAndSocket,
  BROWSER_PATHS,
};
```

- [ ] **Step 2: Verify syntax**

Run: `node -c native/browser-launcher.cjs`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add native/browser-launcher.cjs
git commit -m "feat: add browser-launcher module for auto-launch functionality"
```

---

## Task 3: Update `install-native-host.cjs` to save browser config

**Files:**
- Modify: `scripts/install-native-host.cjs`

- [ ] **Step 1: Find where to save config**

After the install loop (around line 304), add config saving after the console.log of installed browsers.

- [ ] **Step 2: Add config saving code**

Find this section:
```javascript
if (installed.length > 0) {
    console.log("Installed for:");
    for (const { browser, path: p } of installed) {
      console.log(`  ${browser}: ${p}`);
    }
  }
```

Replace with:
```javascript
// Save browser config for auto-launch
const configPath = path.join(os.homedir(), "surf.json");
const fs2 = require("fs");
let surfConfig = {};
try {
  if (fs2.existsSync(configPath)) {
    surfConfig = JSON.parse(fs2.readFileSync(configPath, "utf-8"));
  }
} catch {}

// Use first installed browser as default
const primaryBrowser = browsers[0];
const browserPath = getBrowserPathForCli(primaryBrowser);

surfConfig.browserType = primaryBrowser;
surfConfig.browserPath = browserPath;

try {
  fs2.writeFileSync(configPath, JSON.stringify(surfConfig, null, 2));
  console.log(`\nSaved browser config: ${primaryBrowser}`);
} catch (e) {
  console.error(`\nWarning: Could not save browser config: ${e.message}`);
}

if (installed.length > 0) {
    console.log("Installed for:");
    for (const { browser, path: p } of installed) {
      console.log(`  ${browser}: ${p}`);
    }
  }
```

- [ ] **Step 3: Add helper function and IS_WIN constant**

Add `const IS_WIN = process.platform === "win32";` near the top of the file (around line 4) if not already present.

Add this function before `parseArgs()` (around line 198):

```javascript
function getBrowserPathForCli(browser) {
  if (!IS_WIN) return null;
  const paths = {
    msedge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    chromium: "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    brave: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  };
  return paths[browser] || null;
}
```

- [ ] **Step 4: Test install script help**

Run: `node scripts/install-native-host.cjs --help`
Expected: Help text with `--browser` option

- [ ] **Step 5: Commit**

```bash
git add scripts/install-native-host.cjs
git commit -m "feat(install): save browserType to surf.json on install"
```

---

## Task 4: Update `cli.cjs` to use auto-launch with request replay

**Files:**
- Modify: `native/cli.cjs`

This is the most critical change — we need to refactor the socket communication into a reusable function that can replay the original request after successful browser launch.

- [ ] **Step 1: Add require for browser-launcher**

Find the requires at the top of cli.cjs (around line 1-20) and add:

```javascript
const { ensureBrowserAndSocket } = require("./browser-launcher.cjs");
```

- [ ] **Step 2: Extract `sendRequest` into a reusable function**

In cli.cjs, locate the `sendRequest` function (around line 3003). The current structure wraps socket communication inside a Promise. We need to extract the core socket+sendreceive logic so it can be called directly or retried after launch.

Find this pattern in `sendRequest`:
```javascript
const sendRequest = (toolName, toolArgs = {}) => {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH, () => {
      // ... send request ...
    });
    sock.on("error", (e) => { ... });
    sock.on("data", (d) => { ... resolve(...); });
  });
};
```

**Create a new helper function** `doSendRequest(request, timeoutMs)` that takes a pre-built request object and handles socket connect → send → receive → cleanup:

```javascript
/**
 * Low-level socket request helper that can be called directly or retried.
 * @param {object} request - The request object to send
 * @param {number} timeoutMs - Socket timeout in ms
 * @returns {Promise<any>} - Resolves with the result from extension
 */
function doSendRequest(request, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH, () => {
      sock.write(`${JSON.stringify(request)}\n`);
    });

    let timeout;
    let settled = false;

    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);
      try { sock.destroy(); } catch {}
    };

    timeout = setTimeout(() => {
      if (!settled) {
        cleanup();
        reject(new Error("Request timed out"));
      }
    }, timeoutMs);

    const handleData = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === request.id) {
          cleanup();
          if (msg.error) {
            reject(new Error(msg.error.message || "Request failed"));
          } else {
            resolve(msg.result);
          }
        }
      } catch {}
    };

    sock.on("data", handleData);
    sock.on("error", (e) => {
      if (!settled) {
        cleanup();
        reject(e);
      }
    });
    sock.on("close", () => {
      if (!settled) {
        cleanup();
        reject(new Error("Connection closed"));
      }
    });
  });
}
```

- [ ] **Step 3: Create a `sendRequestWithAutoLaunch` wrapper**

Add this wrapper function that handles the auto-launch flow:

```javascript
/**
 * Send a request with automatic browser launch if needed.
 * @param {string} toolName - Tool to call
 * @param {object} toolArgs - Arguments to pass
 * @param {number} timeoutMs - Timeout
 * @returns {Promise<any>}
 */
async function sendRequestWithAutoLaunch(toolName, toolArgs = {}, timeoutMs = 30000) {
  const request = {
    type: "tool_request",
    method: "execute_tool",
    params: { tool: toolName, args: toolArgs },
    id: `cli-${Date.now()}-${Math.random()}`,
  };

  try {
    // Try direct request first
    return await doSendRequest(request, timeoutMs);
  } catch (err) {
    // If socket error, try auto-launch
    if (err.code === "ENOENT" || err.code === "ECONNREFUSED" || err.message.includes("Connection closed")) {
      try {
        await ensureBrowserAndSocket();
        // Retry the request after successful launch
        return await doSendRequest(request, timeoutMs);
      } catch (launchErr) {
        throw new Error(`Auto-launch failed: ${launchErr.message}`);
      }
    }
    // For other errors (timeout, etc), just rethrow
    throw err;
  }
}
```

- [ ] **Step 4: Replace direct `sendRequest` calls with `sendRequestWithAutoLaunch`**

Find all places where `sendRequest` is called and the pattern is:
```javascript
sendRequest("tool-name", args)
  .then(...)
  .catch(...);
```

Replace with `sendRequestWithAutoLaunch("tool-name", args)`.

**Important:** The `sendRequest` function may still exist for backwards compatibility, but the main CLI command handlers should use `sendRequestWithAutoLaunch` instead.

- [ ] **Step 5: Verify syntax**

Run: `node -c native/cli.cjs`
Expected: no output (success)

- [ ] **Step 6: Commit**

```bash
git add native/cli.cjs
git commit -m "feat(cli): auto-launch browser with request replay on socket failure"
```

---

## Task 5: Manual Testing

- [ ] **Step 1: Kill any running Edge processes**

```powershell
taskkill /F /IM msedge.exe
```

- [ ] **Step 2: Run install with browser flag**

```bash
npm run install:native -- --id lhleggnadbemlcmebhibmncbkchdbbod --browser edge
```

- [ ] **Step 3: Verify config was saved**

```bash
cat ~/.surf/surf.json
# Should contain browserType: "msedge" and browserPath
```

- [ ] **Step 4: Run a surf command without browser running**

```bash
surf tab.list
```

Expected: Edge should launch automatically, then the command should succeed.

---

## Out of Scope (Separate Issues)

The following issues were identified during review but are separate from the auto-launch feature:

1. **Firefox installer registers wrong host** (`scripts/install-firefox-host.cjs`): Registers `host.cjs` (Chrome protocol) instead of `firefox-host.cjs`. Separate fix needed.

2. **Firefox click/key duplicate `type` bug** (`native/firefox-host.cjs:173-186`): Click and key commands declare `type` twice, breaking event routing. Separate fix needed.

These are tracked separately and do not block the auto-launch implementation.

---

## Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| Extension readiness probe via `tab.list` | Task 2: `isExtensionReady()` uses `tab.list` command |
| No process-existence check | Task 2: Only checks extension readiness |
| Config save on install | Task 3: `install-native-host.cjs` saves to surf.json |
| Auto-launch on socket error | Task 4: `sendRequestWithAutoLaunch()` replays request |
| Request replay after launch | Task 4: `doSendRequest()` + retry after `ensureBrowserAndSocket()` |
| 30s timeout | Task 2: `waitForExtensionReady()` default |
| Hidden window launch | Task 2: `launchBrowser()` uses `-WindowStyle Hidden` |

---

## Placeholder Scan

- No "TBD" or "TODO" found
- All function names are concrete and match across tasks
- All file paths are exact
- All commands have expected output specified
