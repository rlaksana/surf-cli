"use strict";

const cp = require("node:child_process");
const { performance } = require("node:perf_hooks");

// NOTE: We use `cp.spawn` (not a destructured `spawn`) so tests can
// override `cp.spawn = mock.fn(...)` and the override is picked up
// at call time.

/**
 * Run `surf <provider> "<prompt>"` with a hard timeout.
 *
 * Returns the raw invocation result — does NOT classify. Caller pipes
 * the result through result-classifier.cjs.
 *
 * Result shape (matches classifier input):
 *   {
 *     status: null,                    // never set here
 *     stdout: string,
 *     stderr: string,
 *     exitCode: number,                // -1 if spawn itself errored
 *     tookMs: number,                  // wall-clock duration
 *     responseLength: number,          // first non-empty stdout line, trimmed
 *   }
 *
 * @param {object} opts
 * @param {string} opts.provider - one of chatgpt, gemini, claude, perplexity, grok, aistudio, aimode
 * @param {string} opts.prompt
 * @param {number} [opts.timeoutMs=90000]
 * @param {string[]} [opts.extraArgs=[]] - additional flags (e.g. ["--model", "thinking"])
 * @returns {Promise<{status: null, stdout: string, stderr: string, exitCode: number, tookMs: number, responseLength: number}>}
 */
async function runProvider({ provider, prompt, timeoutMs = 90000, extraArgs = [] }) {
  const start = performance.now();
  return new Promise((resolve) => {
    const args = [provider, prompt, ...extraArgs];

    let stdout = "";
    let stderr = "";
    let settled = false;

    let child;
    try {
      // shell: true is required on Windows because the `surf` binary is
      // installed as a `.cmd` shim by npm; Node's spawn() doesn't append
      // PATHEXT. The args are all hardcoded here (no user input), so
      // there's no command-injection risk.
      child = cp.spawn("surf", args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
    } catch (e) {
      resolve({
        status: null,
        stdout: "",
        stderr: `spawn error: ${e.message}`,
        exitCode: -1,
        tookMs: Math.round(performance.now() - start),
        responseLength: 0,
      });
      return;
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch {}
      resolve({
        status: null,
        stdout,
        stderr: stderr + `\n[test runner: timeout after ${timeoutMs}ms]`,
        exitCode: 124,  // matches `timeout` cmd convention
        tookMs: timeoutMs,
        responseLength: 0,
      });
    }, timeoutMs);

    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status: null,
        stdout,
        stderr: stderr + `\nspawn error: ${e.message}`,
        exitCode: -1,
        tookMs: Math.round(performance.now() - start),
        responseLength: 0,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status: null,
        stdout,
        stderr,
        exitCode: code === null ? -1 : code,
        tookMs: Math.round(performance.now() - start),
        responseLength: extractResponseLength(stdout),
      });
    });
  });
}

/**
 * Heuristic for "did the model actually respond?": find the first
 * non-empty, non-metadata line in stdout, trim, count chars.
 *
 * Metadata lines we ignore:
 *   - Empty lines
 *   - Lines starting with "[" (surf prints "[model | Xs]" footer)
 *   - Lines that are just "Done" (gemini placeholder)
 */
function extractResponseLength(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[")) continue;
    if (trimmed === "Done") continue;
    return trimmed.length;
  }
  return 0;
}

module.exports = { runProvider, extractResponseLength };
