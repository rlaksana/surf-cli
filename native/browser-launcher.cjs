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
