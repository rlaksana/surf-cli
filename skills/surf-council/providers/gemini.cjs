/**
 * Gemini Provider for Surf Council
 * Wraps 'surf gemini' CLI command with timeout and zombie recovery.
 */

const { spawn } = require("child_process");
const { detectZombieWindows, recoverFromZombies } = require("../recovery/zombie-detector.cjs");

const DEFAULT_TIMEOUT_MS = 180000; // 3 minutes

/**
 * Query Gemini via surf CLI
 * @param {Object} options
 * @param {string} options.query - The query to send
 * @param {number} options.timeout - Timeout in ms (default: 180000)
 * @param {boolean} options.withPage - Include current page context
 * @param {string} options.surfCommand - Surf command path (default: 'surf')
 * @param {string} options.model - Gemini model to use
 * @returns {Promise<{success: boolean, response?: string, error?: string, partialResult?: string, tookMs: number}>}
 */
async function query(options = {}) {
  const {
    query,
    timeout = DEFAULT_TIMEOUT_MS,
    withPage = false,
    surfCommand = "surf",
    model,
  } = options;

  const startTime = Date.now();

  try {
    const result = await spawnWithTimeout(surfCommand, buildArgs(query, withPage, timeout, model), timeout);
    return {
      success: true,
      response: result.stdout,
      tookMs: Date.now() - startTime,
    };
  } catch (error) {
    // Check for zombie windows and attempt recovery
    const zombies = await detectZombieWindows(surfCommand);
    if (zombies.length > 0) {
      await recoverFromZombies(zombies, surfCommand);
      return {
        success: false,
        error: "zombie_recovered",
        partialResult: error.message,
        tookMs: Date.now() - startTime,
      };
    }

    return {
      success: false,
      error: error.message,
      partialResult: error.partialResult,
      tookMs: Date.now() - startTime,
    };
  }
}

function buildArgs(query, withPage, timeout, model) {
  const args = ["gemini", JSON.stringify(query), "--timeout", String(Math.floor(timeout / 1000))];
  if (withPage) {
    args.push("--with-page");
  }
  if (model) {
    args.push("--model", model);
  }
  return args;
}

function spawnWithTimeout(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error("Request timeout"));
      }
    }, timeoutMs + 10000);

    const child = spawn(command, args, {
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
        reject(new Error(err.message));
      }
    });

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();

      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(stderr.trim() || `exit code ${code}`));
      }
    });

    function cleanup() {
      try {
        child.kill();
      } catch {
        // Ignore
      }
    }
  });
}

module.exports = { query };
