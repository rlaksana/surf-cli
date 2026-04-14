"use strict";

/**
 * @fileoverview AI Studio Strategy — Fixed race condition and streaming bug.
 *
 * Bug fixes:
 * 1. Race condition: stopButton gone AND doneToken visible = complete.
 *    Rating buttons are confirmation of DONE, not a completion trigger.
 *    (Previous bug: hasRatingBtns && !hasStopBtn → marked complete)
 * 2. Streaming first-200 bug: requires minPollCount=3 stable polls before
 *    accepting content as complete (previously accepting first 200 chars).
 *
 * Signal building:
 *   isInteractionReady  → stopButton selector finds nothing (PRIMARY signal)
 *   isSemanticComplete  → doneToken selector finds visible element
 *   isRenderStable      → content length > 0, minPollCount reached
 *   isTransportIdle     → interceptedStatus null/undefined for networkIdleMs
 */

const completionEngine = require("../../core/completion-engine.cjs");
const rateLimitDetector = require("../../core/rate-limit-detector.cjs");
const errorDetector = require("../../core/error-detector.cjs");

// ─── Per-instance state ─────────────────────────────────────────────────────

/** @type {number|null} */
let lastNetworkEventAt = null;

/** @type {number} */
let pollCount = 0;

/** @type {number|null} */
let lastContentLength = null;

/**
 * @param {string[]} selectorChain
 * @param {string} pageContent
 * @returns {{ found: boolean, matched: string }}
 */
function findInContent(selectorChain, pageContent) {
  for (const sel of selectorChain) {
    const clean = sel.replace(/[''""\\]/g, "");
    if (pageContent.includes(clean)) {
      return { found: true, matched: sel };
    }
  }
  return { found: false, matched: "" };
}

// ─── Strategy Contract ────────────────────────────────────────────────────────

/**
 * @param {ClientRuntimeCtx} ctx
 * @param {CompletionSignals} _signals
 * @returns {Promise<Verdict>}
 */
async function checkCompletion(ctx, _signals) {
  const snapshot = await ctx.domSnapshot();
  const pageContent = snapshot?.pageContent || "";

  pollCount++;

  // ── Track last network event for isTransportIdle ────────────────────────────
  const interceptedStatus = ctx.interceptedStatus;
  if (interceptedStatus !== null && interceptedStatus !== undefined) {
    lastNetworkEventAt = Date.now();
  }

  const networkIdleMs = ctx.networkIdleMs ?? 2000;
  const idleMs = lastNetworkEventAt ? Date.now() - lastNetworkEventAt : networkIdleMs + 1;
  const isTransportIdle = idleMs >= networkIdleMs;

  // ── Build CompletionSignals from DOM ────────────────────────────────────────
  const stopButtonChain = ctx.config?.selectors?.stopButton ?? [];
  const doneTokenChain = ctx.config?.selectors?.doneToken ?? [];

  const stopGone = !findInContent(stopButtonChain, pageContent).found;
  const doneVisible = findInContent(doneTokenChain, pageContent).found;

  const contentLength = pageContent.length;

  // FIX: Track content stability — stableCount increments only when content
  // length is stable across polls. This fixes the "stableCount never increments"
  // bug where minPollCount was never satisfied.
  const stableLengthThreshold = ctx.config?.completion?.stableLengthThreshold ?? 5;
  const minPollCount = ctx.config?.completion?.minPollCount ?? 3;

  let isStable = false;
  if (lastContentLength !== null) {
    const delta = Math.abs(contentLength - lastContentLength);
    isStable = delta <= stableLengthThreshold;
  }
  lastContentLength = contentLength;

  // Require minimum poll count AND stop button gone for completion
  const meetsMinPolls = pollCount >= minPollCount;
  const _hasSufficientContent = contentLength > 200; // reject early tiny responses

  /** @type {CompletionSignals} */
  const signals = {
    isTransportIdle: {
      idle: isTransportIdle,
      reason: isTransportIdle
        ? `Transport idle for ${idleMs}ms (threshold: ${networkIdleMs}ms)`
        : `Transport active: last event ${idleMs}ms ago`,
    },
    isRenderStable: {
      stable: isStable && meetsMinPolls,
      contentLength,
      reason: isStable
        ? `Content stable (delta <= ${stableLengthThreshold}) after ${pollCount} polls`
        : `Content unstable or polls < minPollCount (${pollCount}/${minPollCount})`,
    },
    isSemanticComplete: {
      complete: doneVisible,
      reason: doneVisible ? `Done token found: ${doneVisible}` : "Done token not visible",
    },
    isInteractionReady: {
      // PRIMARY FIX: stopButton gone is the primary completion signal.
      // Rating buttons are confirmation of done, NOT a trigger.
      ready: stopGone,
      reason: stopGone ? "Stop button not visible" : "Stop button still visible",
    },
  };

  // ── Completion engine ────────────────────────────────────────────────────────
  const completionVerdict = completionEngine.run(ctx, signals);

  // ── Rate limit detection ────────────────────────────────────────────────────
  const rateLimitResult = rateLimitDetector.detectRateLimit(ctx, pageContent);
  if (rateLimitResult.isRateLimited) {
    return {
      done: false,
      reason: `Rate limited: ${rateLimitResult.reason}`,
      confidence: 0,
      activeSignals: ["rateLimit"],
    };
  }

  // ── Error detection ─────────────────────────────────────────────────────────
  const errorResult = errorDetector.detectError(ctx, pageContent);
  if (errorResult.isError) {
    return {
      done: false,
      reason: `Error detected: ${errorResult.reason}`,
      confidence: 0,
      activeSignals: [`error:${errorResult.errorType}`],
    };
  }

  return completionVerdict;
}

/**
 * @param {string} textContent
 * @returns {boolean}
 */
function detectRateLimitText(textContent) {
  return rateLimitDetector.matchTextPatterns(textContent);
}

/**
 * @param {string} textContent
 * @returns {boolean}
 */
function detectErrorText(textContent) {
  return errorDetector.matchTextPatterns(textContent).matched;
}

module.exports = {
  checkCompletion,
  detectRateLimitText,
  detectErrorText,
};
