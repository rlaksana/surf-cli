"use strict";

/**
 * @fileoverview Gemini DOM Selectors — Fallback chains for completion detection.
 * Minimal implementation with verified selectors for gemini.google.com.
 */

module.exports = {
  responseContainer: [
    '[data-testid="response"]',
    "message-content",
    '[class*="response"]',
    '[class*="generation"]',
    '[role="article"]',
  ],
  stopButton: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button[data-testid="stop-generating"]',
    "mat-progress-bar",
  ],
  doneToken: ["message-content", '[data-testid="done"]', '[class*="done"]'],
  rateLimitText: [
    /rate limit/i,
    /too many requests/i,
    /quota exceeded/i,
    /try again in/i,
    /model is overloaded/i,
  ],
  errorText: [
    /something went wrong/i,
    /error/i,
    /failed/i,
    /could not generate/i,
    /invalid request/i,
  ],
};
