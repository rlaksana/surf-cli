"use strict";

/**
 * @fileoverview Tests for completion-engine.cjs
 * Verifies the formula: done = (isSemanticComplete.complete OR isInteractionReady.ready)
 *                       AND (isTransportIdle.idle OR maxTimeout)
 */

const { run, checkMaxTimeout, buildVerdict } = require("./completion-engine.cjs");

// Minimal context for testing
function makeCtx(startTime = Date.now(), maxTimeout = 30000) {
  return {
    tabId: 1,
    config: {
      completion: {
        maxTimeout,
      },
    },
    _startTime: startTime,
  };
}

// Minimal signals for testing
function makeSignals(overrides = {}) {
  return {
    isTransportIdle: { idle: false, reason: "not idle" },
    isRenderStable: { stable: false, contentLength: 0, reason: "not stable" },
    isSemanticComplete: { complete: false, reason: "not complete" },
    isInteractionReady: { ready: false, reason: "not ready" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

let _passed = 0;
let failed = 0;

function assert(condition, _msg) {
  if (condition) {
    _passed++;
  } else {
    failed++;
  }
}

// Case 1: Both semantic and transport true → done
{
  const ctx = makeCtx();
  const signals = makeSignals({
    isSemanticComplete: { complete: true, reason: "done" },
    isTransportIdle: { idle: true, reason: "idle" },
  });
  const v = run(ctx, signals);
  assert(v.done === true, "Both true → done");
  assert(v.confidence === 2, "Confidence = 2 (semantic + idle)");
  assert(v.activeSignals.includes("isSemanticComplete"), "isSemanticComplete active");
  assert(v.activeSignals.includes("isTransportIdle"), "isTransportIdle active");
}

// Case 2: Semantic true, transport false, no timeout → incomplete
{
  const ctx = makeCtx(Date.now() - 1000); // recent start
  const signals = makeSignals({
    isSemanticComplete: { complete: true, reason: "done" },
    isTransportIdle: { idle: false, reason: "not idle" },
  });
  const v = run(ctx, signals);
  assert(v.done === false, "Semantic true, transport false, no timeout → incomplete");
}

// Case 3: Semantic true, transport false, BUT timeout → done
{
  const ctx = makeCtx(Date.now() - 60000, 30000); // started 60s ago, timeout 30s
  const signals = makeSignals({
    isSemanticComplete: { complete: true, reason: "done" },
    isTransportIdle: { idle: false, reason: "not idle" },
  });
  const v = run(ctx, signals);
  assert(v.done === true, "Semantic true, transport false, timeout hit → done");
  assert(v.activeSignals.includes("maxTimeout"), "maxTimeout active");
}

// Case 4: isInteractionReady instead of isSemanticComplete
{
  const ctx = makeCtx();
  const signals = makeSignals({
    isInteractionReady: { ready: true, reason: "input ready" },
    isTransportIdle: { idle: true, reason: "idle" },
  });
  const v = run(ctx, signals);
  assert(v.done === true, "isInteractionReady + transport idle → done");
  assert(v.activeSignals.includes("isInteractionReady"), "isInteractionReady active");
}

// Case 5: Neither semantic signal true → incomplete even with idle
{
  const ctx = makeCtx();
  const signals = makeSignals({
    isSemanticComplete: { complete: false, reason: "not done" },
    isInteractionReady: { ready: false, reason: "not ready" },
    isTransportIdle: { idle: true, reason: "idle" },
  });
  const v = run(ctx, signals);
  assert(v.done === false, "No semantic signal → incomplete");
  assert(v.activeSignals.includes("isTransportIdle"), "isTransportIdle still counted");
}

// Within timeout
{
  const ctx = makeCtx(Date.now() - 5000, 30000);
  const result = checkMaxTimeout(ctx);
  assert(result.timedOut === false, "Within timeout → not timed out");
  assert(result.reason.includes("Within timeout"), "Reason mentions within timeout");
}

// At timeout boundary
{
  const ctx = makeCtx(Date.now() - 30000, 30000);
  const result = checkMaxTimeout(ctx);
  assert(result.timedOut === true, "At exactly maxTimeout → timed out");
}

// Past timeout
{
  const ctx = makeCtx(Date.now() - 60000, 30000);
  const result = checkMaxTimeout(ctx);
  assert(result.timedOut === true, "Past timeout → timed out");
}
{
  const v1 = run(null, makeSignals());
  assert(v1.done === false, "Null ctx → not done");
  assert(v1.confidence === 0, "Confidence 0 for invalid args");

  const v2 = run(makeCtx(), null);
  assert(v2.done === false, "Null signals → not done");
}

// All 4 signals true (plus timeout gives 5, but max 4 shown)
{
  const ctx = makeCtx(Date.now() - 60000, 30000); // timed out
  const signals = makeSignals({
    isSemanticComplete: { complete: true, reason: "done" },
    isInteractionReady: { ready: true, reason: "ready" },
    isTransportIdle: { idle: true, reason: "idle" },
  });
  const v = run(ctx, signals);
  assert(v.done === true, "All signals → done");
  // confidence counts: semanticComplete(1) + interactionReady(1) + transportIdle(1) + maxTimeout(1) = 4
  assert(v.confidence === 4, "Confidence = 4 when all pass");
}

if (failed > 0) {
  process.exit(1);
}
