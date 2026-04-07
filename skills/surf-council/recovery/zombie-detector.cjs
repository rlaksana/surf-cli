/**
 * Zombie Window Detection Module
 * Detects and recovers from orphaned surf-managed windows that have no active tabs.
 */

const { spawn } = require("child_process");
const { isSocketHealthy } = require("./socket-health.cjs");

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Detect zombie windows - surf-managed windows with no active tabs.
 * A zombie window is a window that surf created but which now has 0 tabs.
 * @param {string} surfCommand - The surf command to run (default: 'surf')
 * @returns {Promise<Array<{id: number, focused: boolean, type: string, state: string, width: number, height: number, tabCount: number}>>}
 */
async function detectZombieWindows(surfCommand = "surf") {
  const health = await isSocketHealthy(surfCommand);

  if (!health.healthy || !health.windows) {
    // If socket isn't healthy, we can't detect zombies
    return [];
  }

  // Zombie = window with 0 tabs (surf-created but all tabs closed)
  const zombies = health.windows.filter(w => w.tabCount === 0);

  return zombies;
}

/**
 * Force-close zombie windows via 'surf window close <id>'
 * @param {Array<{id: number}>} zombies - Array of zombie window objects
 * @param {string} surfCommand - The surf command to run (default: 'surf')
 * @returns {Promise<{closed: number, failed: Array<{id: number, reason: string}>}>}
 */
async function recoverFromZombies(zombies, surfCommand = "surf") {
  const results = { closed: 0, failed: [] };

  for (const zombie of zombies) {
    try {
      await closeWindow(zombie.id, surfCommand);
      results.closed++;
    } catch (err) {
      results.failed.push({ id: zombie.id, reason: err.message });
    }
  }

  return results;
}

/**
 * Close a window by ID using surf command
 * @param {number} windowId - Window ID to close
 * @param {string} surfCommand - The surf command to run
 * @returns {Promise<void>}
 */
function closeWindow(windowId, surfCommand = "surf") {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let stderr = "";

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error(`timeout closing window ${windowId}`));
      }
    }, DEFAULT_TIMEOUT_MS);

    const child = spawn(surfCommand, ["window", "close", String(windowId)], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();

      if (code !== 0) {
        const errorMsg = stderr.trim() || `exit code ${code}`;
        reject(new Error(`failed to close window ${windowId}: ${errorMsg}`));
        return;
      }

      resolve();
    });

    function cleanup() {
      try {
        child.kill();
      } catch {
        // Ignore kill errors
      }
    }
  });
}

module.exports = { detectZombieWindows, recoverFromZombies };
