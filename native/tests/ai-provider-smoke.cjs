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
const { execSync } = require("node:child_process");

const { runProvider } = require("./lib/surf-client.cjs");
const { classify } = require("./lib/result-classifier.cjs");
const { captureFourStates } = require("./lib/snapshot-capture.cjs");
const { render: renderTable } = require("./lib/console-table.cjs");

const PONG_PROMPT = "Reply with the single word PONG and nothing else";

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
