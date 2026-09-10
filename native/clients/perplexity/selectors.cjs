"use strict";

/**
 * @fileoverview Perplexity DOM Selectors — Fallback chains for completion detection.
 * Perplexity has zero required cookies (Phase 1 trivially passes).
 * Phase 2 still performs HTTP ping to validate session.
 */

module.exports = {
  responseContainer: [
    ".prose",
    '[class*="response"]',
    '[class*="answer"]',
    '[data-testid="pulse-answer"]',
  ],
  stopButton: [
    'button[aria-label*="stop"]',
    'button[aria-label*="Stop"]',
    'button[data-testid="stop-button"]',
  ],
  doneToken: [
    'aria-label="Copy"',
    'aria-label="copy"',
    'data-testid="copy-button"',
    'aria-label="Regenerate"',
    'aria-label="regenerate"',
  ],
  rateLimitText: [/rate limit/i, /too many requests/i, /try again in/i, /slow down/i],
  errorText: [/something went wrong/i, /error/i, /failed/i, /not found/i],
};
