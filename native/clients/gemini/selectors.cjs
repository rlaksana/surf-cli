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
  // 2026-09-25 live capture: stop control is "Stop response". The a11y tree
  // carries accessible names as plain text — bare-text entries are the ones
  // findInContent can match; mat-progress-bar can persist after stream end,
  // so it is never treated as a stop signal.
  stopButton: ["Stop response", 'button[aria-label="Stop response"]', "Stop"],
  // 2026-09-25 live capture: completed answers expose these action buttons
  // (verbatim accessible names), hover-independent — reliable done tokens.
  doneToken: ["Good response", "Show more options", "Redo", ".message-content"],
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
