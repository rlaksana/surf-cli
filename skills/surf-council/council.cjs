/**
 * Council Core - Multi-AI Provider Orchestration
 * Runs multiple AI providers in parallel and synthesizes responses.
 */

const { spawn } = require("child_process");
const path = require("path");

// Default providers in priority order (first successful is preferred for synthesis)
const DEFAULT_PROVIDERS = ["chatgpt", "gemini", "aimode"];

// Priority order for synthesis when multiple providers succeed
const PROVIDER_PRIORITY = ["chatgpt", "gemini", "aimode"];

const DEFAULT_TIMEOUT_MS = {
  chatgpt: 300000,  // 5 min
  gemini: 180000,   // 3 min
  aimode: 120000,   // 2 min
};

const OVERALL_TIMEOUT_MS = 480000; // 8 min

/**
 * Run a single provider query via surf CLI
 * @param {string} provider - Provider name (chatgpt, gemini, aimode)
 * @param {string} query - The query to send
 * @param {object} opts - Options { withPage, timeoutMs }
 * @returns {Promise<{success: boolean, result?: any, error?: string, provider: string}>}
 */
function runProviderQuery(provider, query, opts = {}) {
  const { withPage = false, timeoutMs = DEFAULT_TIMEOUT_MS[provider] || 120000 } = opts;

  return new Promise((resolve) => {
    let resolved = false;
    let stdout = "";
    let stderr = "";
    const startTime = Date.now();

    const args = [provider, `"${query.replace(/"/g, '\\"')}"`];
    if (withPage) {
      args.push("--with-page");
    }

    const child = spawn("surf", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          success: false,
          provider,
          error: `timeout after ${timeoutMs}ms`,
          duration: Date.now() - startTime,
        });
      }
    }, timeoutMs);

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
        resolve({
          success: false,
          provider,
          error: err.message,
          duration: Date.now() - startTime,
        });
      }
    });

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();

      if (code !== 0) {
        const errorMsg = stderr.trim() || `exit code ${code}`;
        resolve({
          success: false,
          provider,
          error: errorMsg,
          duration: Date.now() - startTime,
        });
        return;
      }

      // Parse output - try to extract JSON result
      try {
        // Find JSON in output (surf may print other text)
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          resolve({
            success: true,
            provider,
            result,
            duration: Date.now() - startTime,
          });
        } else {
          // No JSON found - treat as plain text success
          resolve({
            success: true,
            provider,
            result: { text: stdout.trim() },
            duration: Date.now() - startTime,
          });
        }
      } catch (parseErr) {
        // JSON parse failed - still a successful execution with raw output
        resolve({
          success: true,
          provider,
          result: { text: stdout.trim() },
          duration: Date.now() - startTime,
        });
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

/**
 * Run all providers in parallel using Promise.allSettled
 * @param {string[]} providers - Array of provider names
 * @param {string} query - The query to send
 * @param {object} opts - Options { withPage, perProviderTimeouts }
 * @returns {Promise<Array<{status: 'fulfilled'|'rejected', value: object}>>}
 */
function runAllProviders(providers, query, opts = {}) {
  const { withPage = false, perProviderTimeouts = {} } = opts;

  const promises = providers.map((provider) =>
    runProviderQuery(provider, query, {
      withPage,
      timeoutMs: perProviderTimeouts[provider] || DEFAULT_TIMEOUT_MS[provider] || 120000,
    })
  );

  return Promise.allSettled(promises);
}

/**
 * Synthesize a response from multiple provider results
 * Uses priority order: chatgpt > gemini > aimode
 * @param {Array} results - Array of successful results
 * @param {string[]} successfulProviders - List of providers that succeeded
 * @returns {object} - The synthesized response
 */
function synthesizeResponse(results, successfulProviders) {
  // Sort by priority
  const sorted = PROVIDER_PRIORITY.filter((p) => successfulProviders.includes(p));

  if (sorted.length === 0) {
    return {
      synthesized: null,
      primaryProvider: null,
      note: "No providers succeeded",
    };
  }

  const primaryProvider = sorted[0];
  const primaryResult = results.find(
    (r) => r.provider === primaryProvider && r.success
  );

  return {
    synthesized: primaryResult?.result || null,
    primaryProvider,
    allProvidersTried: PROVIDER_PRIORITY.filter((p) =>
      results.some((r) => r.provider === p)
    ),
    successfulProviders: sorted,
  };
}

/**
 * Main council query function
 * @param {object} options
 * @param {string} options.query - The query to send to all providers
 * @param {string[]} [options.providers] - Provider names (default: ['chatgpt', 'gemini', 'aimode'])
 * @param {object} [options.perProviderTimeouts] - Custom timeouts per provider in ms
 * @param {boolean} [options.withPage] - Include current page context
 * @param {function} [options.onProviderResult] - Callback for each provider result
 * @returns {Promise<{results, synthesized, successfulProviders, failedProviders}>}
 */
async function councilQuery(options = {}) {
  const {
    query,
    providers = DEFAULT_PROVIDERS,
    perProviderTimeouts = {},
    withPage = false,
    onProviderResult = null,
  } = options;

  if (!query) {
    throw new Error("councilQuery requires a query string");
  }

  // Set up overall timeout
  const overallTimeout = new Promise((resolve) =>
    setTimeout(() => {
      resolve({ timedOut: true });
    }, OVERALL_TIMEOUT_MS)
  );

  // Run all providers in parallel
  const providerPromise = runAllProviders(providers, query, {
    withPage,
    perProviderTimeouts,
  });

  // Race between providers and overall timeout
  const raceResult = await Promise.race([providerPromise, overallTimeout]);

  let results;
  let timedOut = false;

  if (raceResult.timedOut) {
    timedOut = true;
    results = [];
  } else {
    results = raceResult.map((result) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          success: false,
          provider: "unknown",
          error: result.reason?.message || "unknown error",
        };
      }
    });
  }

  // Notify callback for each result
  if (onProviderResult) {
    for (const result of results) {
      try {
        onProviderResult(result);
      } catch (callbackErr) {
        // Ignore callback errors
      }
    }
  }

  // Separate successful and failed
  const successfulProviders = results
    .filter((r) => r.success)
    .map((r) => r.provider);

  const failedProviders = results
    .filter((r) => !r.success)
    .map((r) => ({ provider: r.provider, error: r.error }));

  // Synthesize response from priority order
  const synthesis = synthesizeResponse(results, successfulProviders);

  return {
    results,
    synthesized: synthesis.synthesized,
    primaryProvider: synthesis.primaryProvider,
    successfulProviders,
    failedProviders: timedOut
      ? [...failedProviders, { provider: "overall", error: "overall timeout" }]
      : failedProviders,
    timedOut,
  };
}

module.exports = {
  councilQuery,
  runProviderQuery,
  synthesizeResponse,
  DEFAULT_PROVIDERS,
  PROVIDER_PRIORITY,
  DEFAULT_TIMEOUT_MS,
};
