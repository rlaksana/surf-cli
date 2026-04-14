"use strict";

/**
 * @fileoverview Grok Strategy — Standard streaming completion.
 *
 * Signal building:
 *   isInteractionReady  → stopButton selector finds nothing
 *   isSemanticComplete  → doneToken selector finds visible element
 *   isRenderStable      → content length > 0
 *   isTransportIdle     → interceptedStatus null/undefined for networkIdleMs
 */

const completionEngine = require("../../core/completion-engine.cjs");
const rateLimitDetector = require("../../core/rate-limit-detector.cjs");
const errorDetector = require("../../core/error-detector.cjs");

// ─── Per-instance state ─────────────────────────────────────────────────────

/** @type {number|null} */
let lastNetworkEventAt = null;

/**
 * Find the first present element for a selector chain in pageContent string.
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
 * @param {CompletionSignals} _signals  // ignored; we build our own from DOM
 * @returns {Promise<Verdict>}
 */
async function checkCompletion(ctx, _signals) {
  const snapshot = await ctx.domSnapshot();
  const pageContent = snapshot?.pageContent || "";

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

  /** @type {CompletionSignals} */
  const signals = {
    isTransportIdle: {
      idle: isTransportIdle,
      reason: isTransportIdle
        ? `Transport idle for ${idleMs}ms (threshold: ${networkIdleMs}ms)`
        : `Transport active: last event ${idleMs}ms ago`,
    },
    isRenderStable: {
      stable: contentLength > 0,
      contentLength,
      reason: contentLength > 0 ? `Content length: ${contentLength} chars` : "No content rendered",
    },
    isSemanticComplete: {
      complete: doneVisible,
      reason: doneVisible ? `Done token found: ${doneVisible}` : "Done token not visible",
    },
    isInteractionReady: {
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
