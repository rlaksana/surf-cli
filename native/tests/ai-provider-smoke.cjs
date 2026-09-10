#!/usr/bin/env node
"use strict";

/**
 * AI Provider Stability Test
 *
 * Stage 1: Sequential PONG smoke against all 7 AI providers
 * Stage 2: On failure, capture 4-state a11y tree snapshots
 *
 * See: docs/superpowers/specs/2026-06-12-ai-provider-stability-test-design.md
 */

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { execSync } = cp;

const { runProvider } = require("./lib/surf-client.cjs");
const { classify } = require("./lib/result-classifier.cjs");
const { captureFourStates } = require("./lib/snapshot-capture.cjs");
const { render: renderTable } = require("./lib/console-table.cjs");

const PONG_PROMPT = "Reply with the single word PONG and nothing else";

// ─── Tab lifecycle: defensive cleanup ─────────────────────────────────
// Snapshot user tabs at start; close any tabs the test opens afterward.
// This is a safety net for: stale extension SW, client exceptions before
// `finally closeTab`, snapshot-capture openTab timeout, SIGKILL of this
// process. Opt-out with AI_SMOKE_KEEP_TABS=1.

// Pre-test: kill any orphan surf processes from previous runs that died
// holding the browser lock (SIGKILL timeout). Without this, aimode stage 1
// fails with "Timed out waiting for browser lock after 60s" because the
// lock dir is < 30s old and claimAndRemoveStaleLock refuses to remove it.
async function killOrphanSurfProcesses() {
  if (process.platform !== "win32") return;
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      const child = cp.spawn("wmic", [
        "process", "where",
        "name='node.exe'",
        "get", "processid,commandline",
      ], { stdio: ["ignore", "pipe", "pipe"], shell: true });
      let out = "";
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} reject(new Error("wmic timeout")); }, 8000);
      child.stdout.on("data", (c) => (out += c.toString()));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", () => { clearTimeout(timer); resolve({ stdout: out }); });
    });
    const myPid = process.pid;
    let killed = 0;
    for (const line of stdout.split(/\r?\n/)) {
      // Match any surf-cli process: host.cjs, cli.cjs, ai-provider-smoke.
      // cli.cjs zombie is the most common (socket hang on Windows).
      if (!/surf-cli|native\\(host|cli)\.cjs|native\/(host|cli)\.cjs|ai-provider-smoke/.test(line)) continue;
      const m = line.match(/^\s*(\d+)\s+/);
      if (!m) continue;
      const pid = Number.parseInt(m[1], 10);
      if (pid === myPid || pid <= 0) continue;
      try {
        process.kill(pid, "SIGKILL");
        killed++;
      } catch {}
    }
    if (killed > 0) {
      process.stderr.write(`[ai-smoke] Killed ${killed} orphan surf process(es)\n`);
    }
  } catch (e) {
    // best-effort
  }
}
async function listTabs() {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { stdout } = await new Promise((resolve, reject) => {
        const child = cp.spawn("surf", ["tab.list"], {
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
        });
        let out = "";
        const timer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch {}
          reject(new Error("tab.list timeout"));
        }, 10000);
        child.stdout.on("data", (c) => (out += c.toString()));
        child.on("error", (e) => { clearTimeout(timer); reject(e); });
        child.on("close", (code) => {
          clearTimeout(timer);
          code === 0 ? resolve({ stdout: out, stderr: "" }) : reject(new Error(`tab.list exited ${code}`));
        });
      });
      // Format: "<id>\t<title>\t<url>"
      const tabs = stdout
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => {
          const [id, ...rest] = l.split("\t");
          return { id: Number.parseInt(id, 10), title: rest[0] || "", url: rest.slice(1).join("\t") };
        })
        .filter((t) => Number.isFinite(t.id));
      return tabs;
    } catch (e) {
      process.stderr.write(`[ai-smoke] listTabs attempt ${attempt}/${MAX_ATTEMPTS} failed: ${e.message}\n`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  return []; // best-effort fallback
}

async function closeTab(tabId) {
  try {
    await new Promise((resolve, reject) => {
      const child = cp.spawn("surf", ["tab.close", String(tabId)], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        reject(new Error("tab.close timeout"));
      }, 8000);
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`tab.close exited ${code}`));
      });
    });
  } catch {}
}

async function cleanupLeakedTabs(initialIds, log = () => {}) {
  if (process.env.AI_SMOKE_KEEP_TABS === "1") return;
  const current = await listTabs();
  const leaked = current.filter((t) => !initialIds.has(t.id));
  if (leaked.length === 0) {
    log(`[ai-smoke] Cleanup: 0 leaked tabs (initial ${initialIds.size}, current ${current.length})`);
    return;
  }
  log(`[ai-smoke] Cleanup: closing ${leaked.length} leaked tab(s) [${leaked.map((t) => t.id).join(", ")}]`);
  for (const t of leaked) {
    await closeTab(t.id);
  }
}

// Register process-level cleanup so a SIGINT/SIGTERM during the test still
// cleans up. Best-effort — runs sync tab.list via spawn can't await in
// signal handler, so we log and rely on the explicit post-test sweep.
let cleanupSweep = null;
function registerCleanup(sweep) {
  cleanupSweep = sweep;
  const handler = () => {
    if (cleanupSweep) {
      cleanupSweep().catch(() => {});
    }
    process.exit(130);
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

/**
 * Provider config: name, optional extra args, model hint.
 * The runner passes `--model <hint>` to providers that support it.
 */
const PROVIDERS = [
  { name: "chatgpt", extraArgs: ["--model", "thinking"], timeoutMs: 120000 },
  { name: "gemini", extraArgs: [], timeoutMs: 90000 },
  { name: "claude", extraArgs: [], timeoutMs: 90000 },
  { name: "perplexity", extraArgs: [], timeoutMs: 90000 },
  { name: "grok", extraArgs: [], timeoutMs: 90000 },
  { name: "aistudio", extraArgs: [], timeoutMs: 90000 },
  { name: "aimode", extraArgs: [], timeoutMs: 90000 },
];

/**
 * Main entry point. Returns {exitCode, summary, results}.
 * If captureOnFailure=true, runs snapshot capture for selector/timeout/error FAILs.
 */
async function runSmokeTest({
  reportDir,
  captureOnFailure = true,
  providers = PROVIDERS,
} = {}) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseDir = reportDir || path.join(".research", `ai-smoke-${timestamp}`);
  fs.mkdirSync(baseDir, { recursive: true });

  // Clear orphan surf processes from previous runs that died holding the
  // browser lock. Without this, repeated runs deadlock on lock acquisition.
  await killOrphanSurfProcesses();

  // Defensive cleanup: snapshot user's tabs so we can close any leaked
  // tabs at the end (covers stale SW, client exceptions before
  // `finally closeTab`, snapshot-capture openTab timeout).
  const initialTabs = await listTabs();
  const initialTabIds = new Set(initialTabs.map((t) => t.id));
  process.stderr.write(
    `[ai-smoke] Tracking ${initialTabIds.size} user tab(s) for cleanup\n`,
  );
  const sweep = () =>
    cleanupLeakedTabs(initialTabIds, (msg) =>
      process.stderr.write(`${msg}\n`),
    );
  registerCleanup(sweep);

  const results = [];
  for (const p of providers) {
    process.stderr.write(`[ai-smoke] Testing ${p.name}...\n`);

    const raw = await runProvider({
      provider: p.name,
      prompt: PONG_PROMPT,
      timeoutMs: p.timeoutMs,
      extraArgs: p.extraArgs,
    });

    const classification = classify(raw);
    const firstChars =
      raw.stdout
        .split("\n")
        .find((l) => l.trim() && !l.trim().startsWith("[")) || "";

    const result = {
      provider: p.name,
      status: classification.status,
      tookMs: raw.tookMs,
      responseLength: raw.responseLength,
      firstChars: firstChars.slice(0, 200),
      failureKind: classification.failureKind,
      rawStdout: raw.stdout,
      rawStderr: raw.stderr,
      exitCode: raw.exitCode,
      snapshotsDir: null,
    };

    // Stage 2: capture on regression-class failures
    if (
      captureOnFailure &&
      classification.status === "FAIL" &&
      ["selector", "complete-timeout", "error"].includes(
        classification.failureKind,
      )
    ) {
      const providerDir = path.join(baseDir, p.name);
      process.stderr.write(
        `[ai-smoke] Capturing snapshots for ${p.name} (${classification.failureKind})...\n`,
      );
      const capture = await captureFourStates({
        provider: p.name,
        outDir: providerDir,
        timeoutMs: 60000,
      });
      result.snapshotsDir = providerDir;
      result.snapshotCaptureErrors = capture.errors;
    }

    results.push(result);
    process.stderr.write(
      `[ai-smoke]   ${p.name}: ${result.status} (${(result.tookMs / 1000).toFixed(1)}s, ${result.responseLength} chars, ${result.failureKind || "ok"})\n`,
    );
  }

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    exitCode: results.every((r) => r.status === "PASS") ? 0 : 1,
  };

  // Console table to stdout
  console.log(renderTable(results));

  // JSON report
  const report = {
    timestamp: new Date().toISOString(),
    surfVersion: getSurfVersion(),
    summary,
    results,
  };
  fs.writeFileSync(
    path.join(baseDir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  process.stderr.write(
    `[ai-smoke] Report: ${path.join(baseDir, "report.json")}\n`,
  );

  // Defensive cleanup: close any tabs the test opened but failed to close.
  await sweep();

  return { exitCode: summary.exitCode, summary, results, reportDir: baseDir };
}

function getSurfVersion() {
  try {
    return execSync("surf --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

// CLI entry point
if (require.main === module) {
  const opts = {
    reportDir: process.env.AI_SMOKE_DIR || null,
    captureOnFailure: process.env.AI_SMOKE_NO_CAPTURE !== "1",
  };
  runSmokeTest(opts).then(({ exitCode }) => {
    process.exit(exitCode);
  });
}

module.exports = { runSmokeTest, PROVIDERS, PONG_PROMPT };
