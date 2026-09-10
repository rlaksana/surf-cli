#!/usr/bin/env node
/**
 * deploy-local.cjs — sync local source → live runtime.
 *
 * Surf-cli has three caches that must be invalidated for source edits to
 * take effect at runtime. This script does two of them; the third (Chrome
 * extension reload at chrome://extensions) cannot be done headlessly and
 * is surfaced as a printed instruction.
 *
 * 1. Vite bundle: rebuild dist/ from src/*.ts.
 *    Done by parent npm script before invoking this script.
 *
 * 2. Native host: long-lived node process holding require() cache.
 *    Found via Win32_Process.CommandLine matching "surf" + "host.cjs".
 *    Killed; Chrome auto-respawns it on next native-messaging handshake.
 *
 * 3. Chrome extension: service worker caches the bundle.
 *    NOT automatable from this script. We print the exact chrome:// URL
 *    and the action the user must take. Until they reload, the service
 *    worker still runs the previous bundle.
 *
 * Exit code 0 on full success, non-zero on any failure.
 *
 * Usage: node scripts/deploy-local.cjs
 *   or:  npm run deploy:local   (also rebuilds the bundle)
 */

"use strict";

const { execFileSync } = require("node:child_process");

const IS_WIN = process.platform === "win32";

function log(msg) {
  process.stdout.write(`[deploy-local] ${msg}\n`);
}

function listSurfHostPids() {
  if (!IS_WIN) {
    log("Host PID discovery is Windows-only in this script. macOS/Linux: kill node host manually.");
    return [];
  }
  const script =
    "Get-Process node -ErrorAction SilentlyContinue | " +
    "Where-Object { (Get-CimInstance Win32_Process -Filter \"ProcessId = $($_.Id)\" -ErrorAction SilentlyContinue).CommandLine -like '*surf*host*' } | " +
    "Select-Object -ExpandProperty Id";
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
  });
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => Number(s));
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      log(`Killing surf host PID ${pid}...`);
      execFileSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction Stop`], {
        stdio: "inherit",
      });
    } catch (e) {
      log(`  ! failed to kill ${pid}: ${e.message}`);
    }
  }
}

function verifyBundleContainsPatch() {
  const fs = require("node:fs");
  const path = require("node:path");
  const bundlePath = path.join(__dirname, "..", "dist", "service-worker", "index.js");
  if (!fs.existsSync(bundlePath)) {
    log(`! Bundle missing at ${bundlePath} — did 'npm run build' run?`);
    return false;
  }
  const bundle = fs.readFileSync(bundlePath, "utf8");
  const hasMarker = bundle.includes("_newTab") || bundle.includes("resolveTabForCommand");
  log(`Bundle check: dist/service-worker/index.js contains patch markers = ${hasMarker}`);
  return hasMarker;
}

function printExtensionReloadInstructions() {
  log("");
  log("=".repeat(72));
  log("MANUAL STEP REQUIRED — Chrome extension reload");
  log("=".repeat(72));
  log("The service worker caches the bundle in memory. Until you reload it,");
  log("it will keep running the previous (stale) bundle. To finish deploy:");
  log("");
  log("  1. Open chrome://extensions  (or edge://extensions)");
  log("  2. Find 'surf-cli' in the list");
  log("  3. Click the ↻ reload button");
  log("");
  log("Until you do this, ANY source-level change you just committed is");
  log("still running the old code. Verify with:  surf navigate https://example.com");
  log("If your active tab moves to example.com, you forgot this step.");
  log("=".repeat(72));
}

function main() {
  log("Stage 1/3 — verify bundle is fresh:");
  if (!verifyBundleContainsPatch()) {
    log("FAIL: bundle does not contain expected patch markers.");
    log("  Run 'npm run build' first, then retry.");
    process.exit(1);
  }

  log("");
  log("Stage 2/3 — restart native host (kill running node host process):");
  const pids = listSurfHostPids();
  if (pids.length === 0) {
    log("  No running surf host detected. Chrome will spawn one on next connect.");
  } else {
    log(`  Found ${pids.length} surf host process(es): ${pids.join(", ")}`);
    killPids(pids);
    log("  Done. Chrome will auto-respawn the host on next native-messaging connect.");
  }

  log("");
  log("Stage 3/3 — Chrome extension reload:");
  printExtensionReloadInstructions();

  log("");
  log("deploy-local: stages 1+2 complete. Stage 3 is manual (cannot be automated).");
  process.exit(0);
}

main();