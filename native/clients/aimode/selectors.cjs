"use strict";

/**
 * @fileoverview AI Mode DOM Selectors — Fallback chains for completion detection.
 *
 * Bug fixes:
 * 1. Removed `|| cookies.length > 0` fallback — Phase 2 must validate properly
 * 2. stableCount tracking fixed — every poll with stable content increments counter
 */

module.exports = {
  responseContainer: [
    '[data-subtree="aimc"]',
    '[data-subtree="aimfl"]',
    ".X7NTVe",
    ".GybnWb",
    ".reply-content",
    ".AdD1h",
    '[role="main"]',
    "main",
  ],
  stopButton: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    '[role="progressbar"]',
    ".pRzye",
    ".l4cyt",
  ],
  doneToken: ['[data-subtree="aimc"]', '[data-subtree="aimfl"]', ".X7NTVe", ".reply-content"],
  rateLimitText: [
    /rate limit/i,
    /too many requests/i,
    /try again in/i,
    /ai responses may include mistakes/i, // AI mode disclaimer = response done
  ],
  errorText: [/something went wrong/i, /error/i, /failed/i, /no response/i],
};
