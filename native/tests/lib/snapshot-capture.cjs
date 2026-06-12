"use strict";

const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

// NOTE: Use `cp.spawn` (not destructured) so tests can mock it later.

/**
 * Provider → URL map for the "empty" (idle) state. Matches what
 * `surf <provider>` opens by default.
 */
const PROVIDER_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  claude: "https://claude.ai/new",
  perplexity: "https://www.perplexity.ai/",
  grok: "https://grok.com/",
  aistudio: "https://aistudio.google.com/",
  aimode: "https://www.google.com/search?udm=50&q=hi",
};

/**
 * Capture 4 a11y-tree snapshots of a provider in sequence:
 *   1. empty       — idle chat / new chat
 *   2. submitting  — right after Enter pressed (best-effort: race condition)
 *   3. streaming   — mid-response, text > 50 chars
 *   4. completed   — stop button gone (response fully shown)
 *
 * Saves to <outDir>/snapshots/{empty,submitting,streaming,completed}.txt
 * plus a host-log-tail.txt with the last 200 lines of /tmp/surf/surf-host.log
 * filtered to this tab's tabId (best-effort — log file may be unavailable).
 *
 * @param {object} opts
 * @param {string} opts.provider
 * @param {string} opts.outDir - absolute path to write snapshots into
 * @param {number} [opts.timeoutMs=60000] - per-state capture timeout
 * @returns {Promise<{captured: string[], tabId: number|null, errors: string[]}>}
 */
async function captureFourStates({ provider, outDir, timeoutMs = 60000 }) {
  const url = PROVIDER_URLS[provider];
  if (!url) {
    return { captured: [], tabId: null, errors: [`unknown provider: ${provider}`] };
  }

  const snapshotsDir = path.join(outDir, "snapshots");
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const captured = [];
  const errors = [];
  let tabId = null;

  try {
    // 1. Open a fresh tab
    tabId = await openTab(url);
    await delay(3000); // page load

    // 2. Capture "empty" state
    await captureState({
      tabId,
      outPath: path.join(snapshotsDir, "empty.txt"),
      timeoutMs,
      onError: (e) => errors.push(`empty: ${e}`),
    });
    captured.push("empty");

    // 3. Send the PONG prompt
    await sendPromptInTab(
      tabId,
      "Reply with the single word PONG and nothing else",
    );
    await delay(500);

    // 4. Capture "submitting" state (best-effort — may catch idle or streaming)
    await captureState({
      tabId,
      outPath: path.join(snapshotsDir, "submitting.txt"),
      timeoutMs,
      onError: (e) => errors.push(`submitting: ${e}`),
    });
    captured.push("submitting");

    // 5. Poll for "streaming" — text > 50 chars OR timeout
    const streamingPath = path.join(snapshotsDir, "streaming.txt");
    const streamingDeadline = Date.now() + timeoutMs;
    while (Date.now() < streamingDeadline) {
      const tree = await readA11yTree(tabId);
      const text = extractAllText(tree);
      if (text.length > 50) {
        fs.writeFileSync(streamingPath, tree);
        captured.push("streaming");
        break;
      }
      await delay(500);
    }
    if (!captured.includes("streaming")) {
      errors.push("streaming: timed out waiting for text > 50 chars");
    }

    // 6. Poll for "completed" — stop button gone OR timeout
    const completedPath = path.join(snapshotsDir, "completed.txt");
    const completedDeadline = Date.now() + timeoutMs;
    while (Date.now() < completedDeadline) {
      const tree = await readA11yTree(tabId);
      if (
        tree &&
        !tree.includes("Stop generating") &&
        !tree.includes("stop-button")
      ) {
        fs.writeFileSync(completedPath, tree);
        captured.push("completed");
        break;
      }
      await delay(1000);
    }
    if (!captured.includes("completed")) {
      errors.push("completed: timed out waiting for stop button to disappear");
    }
  } catch (e) {
    errors.push(`fatal: ${e.message}`);
  } finally {
    // 7. Close the tab
    if (tabId) {
      try {
        await closeTab(tabId);
      } catch {}
    }
  }

  // 8. Dump host log tail
  try {
    const logPath = "/tmp/surf/surf-host.log";
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, "utf8").split("\n");
      const tail = lines.slice(-200).join("\n");
      fs.writeFileSync(path.join(outDir, "host-log-tail.txt"), tail);
    }
  } catch (e) {
    errors.push(`log tail: ${e.message}`);
  }

  return { captured, tabId, errors };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function surfSubcommand(args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    // shell: true is required on Windows (npm `.cmd` shim issue; see
    // surf-client.cjs comment). Args are hardcoded.
    const child = cp.spawn("surf", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(new Error(`surf ${args.join(" ")} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`surf ${args[0]} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function openTab(url) {
  // `surf tab.new <url>` prints `[<tabId>] <title> - <hostname>` to stdout
  const { stdout } = await surfSubcommand(["tab.new", url]);
  const m = stdout.match(/^\[(\d+)\]/);
  if (!m) throw new Error(`could not parse tabId from: ${stdout}`);
  return Number.parseInt(m[1], 10);
}

async function closeTab(tabId) {
  await surfSubcommand(["tab.close", String(tabId)]);
}

/**
 * Read the accessibility tree of a tab via `surf page.read --tab-id <id>`.
 * Returns the full text (one element per line, see CLAUDE.md format).
 */
async function readA11yTree(tabId) {
  const { stdout } = await surfSubcommand([
    "page.read",
    "--tab-id",
    String(tabId),
  ]);
  return stdout;
}

/**
 * Type a prompt into the focused input and press Enter.
 * Uses `surf type` + `surf key enter` (lowest-common-denominator, works
 * across all UIs even when selectors differ).
 */
async function sendPromptInTab(tabId, prompt) {
  await surfSubcommand(["type", "--text", prompt, "--tab-id", String(tabId)]);
  await surfSubcommand(["key", "Enter", "--tab-id", String(tabId)]);
}

/**
 * Capture a11y tree to file with a timeout race.
 */
async function captureState({ tabId, outPath, timeoutMs, onError }) {
  try {
    const tree = await Promise.race([
      readA11yTree(tabId),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("readA11yTree timeout")), timeoutMs),
      ),
    ]);
    fs.writeFileSync(outPath, tree);
  } catch (e) {
    if (onError) onError(e.message);
  }
}

/**
 * Extract all visible text from an a11y tree (rough heuristic: each line
 * that looks like an element with a label/text is text content).
 */
function extractAllText(tree) {
  if (!tree) return "";
  // Simple: take everything that looks like a quoted string (element labels)
  const matches = tree.match(/"([^"]{2,})"/g) || [];
  return matches.map((m) => m.slice(1, -1)).join(" ");
}

module.exports = {
  captureFourStates,
  PROVIDER_URLS,
  extractAllText,
};
