const { spawn, execSync, execFileSync } = require("child_process");
const net = require("net");
const path = require("path");
const os = require("os");
const { getBrowserConfig } = require("./config.cjs");

const IS_WIN = process.platform === "win32";
const SOCKET_PATH = IS_WIN ? "//./pipe/surf" : "/tmp/surf.sock";

const BROWSER_PATHS = {
  edge: IS_WIN
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

// Process name used to detect a running browser instance.
// Windows uses .exe; macOS uses the bundle's display name for `pgrep -f`.
const BROWSER_PROCESS_NAMES = {
  edge: IS_WIN ? "msedge.exe" : "msedge",
  chrome: IS_WIN ? "chrome.exe" : "Google Chrome",
  chromium: IS_WIN ? "chromium.exe" : "Chromium",
  brave: IS_WIN ? "brave.exe" : "Brave Browser",
  arc: IS_WIN ? "Arc.exe" : "Arc",
  helium: IS_WIN ? "helium.exe" : "Helium",
};

/**
 * Check if the configured browser is already running.
 * Used to avoid spawning a duplicate browser window when the user
 * has Edge/Chrome already open — we want to attach to the existing
 * session, not fragment it.
 * @param {string} browserType
 * @returns {boolean}
 */
function isBrowserRunning(browserType) {
  const procName = BROWSER_PROCESS_NAMES[browserType];
  if (!procName) return false;

  try {
    if (IS_WIN) {
      // tasklist exits 0 even on no match; check stdout for the "INFO:" sentinel.
      // Use execFileSync (no shell) to avoid metacharacter interpretation.
      const filter = `IMAGENAME eq ${procName}`;
      const output = execFileSync("tasklist", ["/FI", filter, "/NH"], {
        encoding: "utf8",
      });
      return !output.includes("INFO:");
    }
    // macOS / Linux: pgrep exits 1 when no match
    execFileSync("pgrep", ["-f", procName], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch browser via PowerShell Start-Process (runs in correct user session)
 * @param {string} browserType - e.g., "msedge", "chrome"
 * @param {string} [browserPath] - optional explicit path
 * @param {string} [url] - optional URL to open
 * @returns {number|null} - spawned process PID or null
 */
function launchBrowser(browserType, browserPath, url) {
  const execPath = browserPath || BROWSER_PATHS[browserType];

  if (!execPath) {
    throw new Error(`Unknown browser type: ${browserType}`);
  }

  if (IS_WIN) {
    // Windows: use PowerShell Start-Process to run in correct user session context
    // This avoids the session 0 isolation that causes Edge to crash when spawned via execSync('start ...')
    const urlArg = url ? `"${url}"` : "";

    try {
      // Use spawn (async) rather than execSync so we don't block
      const ps = spawn("powershell", [
        "-NoProfile",
        "-Command",
        `Start-Process -FilePath "${execPath}"${urlArg ? ` -ArgumentList ${urlArg}` : ""} -PassThru | Select-Object -ExpandProperty Id`,
      ], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let pid = null;
      ps.stdout.on("data", (data) => {
        const output = data.toString().trim();
        const parsed = parseInt(output, 10);
        if (!isNaN(parsed)) {
          pid = parsed;
        }
      });

      // Detach so the PowerShell process is not killed when Node exits
      ps.unref();
      return pid;
    } catch {
      // Fallback: try direct start without URL
      try {
        const child = spawn("powershell", [
          "-NoProfile",
          "-Command",
          `Start-Process -FilePath "${execPath}"`,
        ], { detached: true, stdio: "ignore", windowsHide: true });
        child.unref();
        return null;
      } catch {
        return null;
      }
    }
  } else if (process.platform === "darwin") {
    // macOS: use open command
    const child = spawn("open", ["-a", execPath], { detached: true, stdio: "ignore" });
    child.unref();
    return child.pid;
  } else {
    // Linux: launch in background
    const child = spawn(execPath, url ? [url] : ["--new-window"], { detached: true, stdio: "ignore" });
    child.unref();
    return child.pid;
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

  // If the browser is already running (e.g., user opened it manually),
  // do NOT spawn a duplicate window — that fragments the user's session
  // and creates a fresh, often logged-out instance. Just wait for the
  // extension to become responsive.
  if (isBrowserRunning(browserType)) {
    console.error(
      `${browserType} is already running. Waiting for extension to connect...`
    );
    await waitForExtensionReady(30000);
    return;
  }

  // Cold start: browser is not running, so launch it.
  console.error(`Launching ${browserType}...`);
  launchBrowser(browserType, browserPath);

  // Wait for extension to connect
  await waitForExtensionReady(30000);
}

module.exports = {
  launchBrowser,
  isExtensionReady,
  isBrowserRunning,
  waitForExtensionReady,
  ensureBrowserAndSocket,
  BROWSER_PATHS,
};
