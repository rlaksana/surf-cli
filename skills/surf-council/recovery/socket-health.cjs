/**
 * Socket Health Check Module
 * Checks if the surf socket is responsive by running 'surf window list'
 * with a 10 second timeout.
 */

const { spawn } = require("child_process");

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Check if the surf socket is healthy by spawning 'surf window list'
 * @param {string} surfCommand - The surf command to run (default: 'surf')
 * @returns {Promise<{healthy: boolean, windows?: Array, reason?: string}>}
 */
async function isSocketHealthy(surfCommand = "surf") {
  return new Promise((resolve) => {
    let resolved = false;
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ healthy: false, reason: "timeout" });
      }
    }, DEFAULT_TIMEOUT_MS);

    const child = spawn(surfCommand, ["window", "list"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve({ healthy: false, reason: err.message });
      }
    });

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();

      if (code !== 0) {
        // Non-zero exit code indicates failure
        const errorMsg = stderr.trim() || `exit code ${code}`;
        resolve({ healthy: false, reason: errorMsg });
        return;
      }

      // Try to parse the output as JSON
      try {
        // The window list output is JSON: { windows: [...] }
        // But the CLI may also print non-JSON text, so find the JSON part
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.windows !== undefined) {
            resolve({ healthy: true, windows: parsed.windows });
            return;
          }
        }
        // If no JSON found or no windows key, treat as healthy with empty result
        resolve({ healthy: true, windows: [] });
      } catch {
        // Parse error - socket might be responding but returning unexpected format
        // This could indicate a stuck or corrupted state
        const errorMsg = stderr.trim() || "invalid response format";
        resolve({ healthy: false, reason: errorMsg });
      }
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

module.exports = { isSocketHealthy };
