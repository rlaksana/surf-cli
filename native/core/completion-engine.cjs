"use strict";

/**
 * @fileoverview Completion Engine — Evaluates 4 signals to determine if AI response is done.
 * Formula: done = (isSemanticComplete.complete OR isInteractionReady.ready)
 *          AND (isTransportIdle.idle OR maxTimeout)
 *
 * maxTimeout is first-class: even if transport is not idle, we've waited too long.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if maxTimeout has been exceeded based on startTime and config.
 * @param {ClientRuntimeCtx} ctx
 * @returns {{ timedOut: boolean, reason: string }}
 */
function checkMaxTimeout(ctx) {
  const maxTimeout = ctx.config?.completion?.maxTimeout ?? 30000;
  const elapsed = Date.now() - (ctx._startTime || Date.now());
  const timedOut = elapsed >= maxTimeout;

  return {
    timedOut,
    reason: timedOut
      ? `Hard timeout exceeded: ${elapsed}ms >= ${maxTimeout}ms`
      : `Within timeout: ${elapsed}ms < ${maxTimeout}ms`,
  };
}

/**
 * Build a Verdict from signal results.
 * @param {boolean} done
 * @param {{ timedOut: boolean }} maxTimeoutResult
 * @param {CompletionSignals} signals
 * @returns {Verdict}
 */
function buildVerdict(done, maxTimeoutResult, signals) {
  /** @type {string[]} */
  const activeSignals = [];
  let confidence = 0;

  // Check semantic completion branch
  if (signals.isSemanticComplete?.complete) {
    activeSignals.push("isSemanticComplete");
    confidence++;
  }
  if (signals.isInteractionReady?.ready) {
    activeSignals.push("isInteractionReady");
    confidence++;
  }

  // Check transport/idle branch
  if (signals.isTransportIdle?.idle) {
    activeSignals.push("isTransportIdle");
    confidence++;
  }
  if (maxTimeoutResult.timedOut) {
    activeSignals.push("maxTimeout");
    confidence++;
  }

  // Build reason
  function getSemanticBranch() {
    if (signals.isSemanticComplete?.complete) {
      return "semantic-complete";
    }
    if (signals.isInteractionReady?.ready) {
      return "interaction-ready";
    }
    return "none";
  }

  function getTransportBranch() {
    if (signals.isTransportIdle?.idle) {
      return "transport-idle";
    }
    if (maxTimeoutResult.timedOut) {
      return "max-timeout";
    }
    return "not-idle";
  }

  const semanticBranch = getSemanticBranch();
  const transportBranch = getTransportBranch();

  const reason = done
    ? `Complete: (${semanticBranch}) AND (${transportBranch})`
    : `Incomplete: waiting for semantic (${semanticBranch}) AND transport (${transportBranch})`;

  return {
    done,
    reason,
    confidence,
    activeSignals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Run Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate completion signals and return a Verdict.
 *
 * @param {ClientRuntimeCtx} ctx - Runtime context (tabId, config, etc.)
 * @param {CompletionSignals} signals - Normalized signals from signal-normalizer
 * @returns {Verdict}
 *
 * Formula: done = (isSemanticComplete.complete OR isInteractionReady.ready)
 *          AND (isTransportIdle.idle OR maxTimeout)
 *
 * maxTimeout is first-class: if we've waited too long, we proceed even if not idle.
 */
function run(ctx, signals) {
  if (!ctx || !signals) {
    return {
      done: false,
      reason: "Invalid args: ctx and signals are required",
      confidence: 0,
      activeSignals: [],
    };
  }

  // Evaluate maxTimeout first (first-class signal)
  const maxTimeoutResult = checkMaxTimeout(ctx);

  // Left side: semantic OR interaction
  const semanticDone =
    signals.isSemanticComplete?.complete === true || signals.isInteractionReady?.ready === true;

  // Right side: transport idle OR maxTimeout
  const transportReady =
    signals.isTransportIdle?.idle === true || maxTimeoutResult.timedOut === true;

  // Full formula
  const done = semanticDone && transportReady;

  return buildVerdict(done, maxTimeoutResult, signals);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  run,
  // Exported for testing
  checkMaxTimeout,
  buildVerdict,
};
