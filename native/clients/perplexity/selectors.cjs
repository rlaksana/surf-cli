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
    // Bare accessible names — findInContent matches a11y tree TEXT only, so
    // CSS attribute forms never match. Live capture 2026-09-25:
    // 'Stop response (Esc)' — bare prefix wins; add Indonesian locale variant.
    "Stop response",
    "Stop responding",
    "Hentikan respons",
    'button[aria-label*="stop"]',
    'button[data-testid="stop-button"]',
  ],
  doneToken: [
    // Live capture 2026-09-25 done-only: Share button, Sources expander,
    // Answer/Links/Images tabs. Bare text first.
    "Share",
    "Sources",
    'aria-label="Copy"',
    'data-testid="copy-button"',
    'aria-label="Regenerate"',
  ],
  rateLimitText: [/rate limit/i, /too many requests/i, /try again in/i, /slow down/i],
  errorText: [/something went wrong/i, /error/i, /failed/i, /not found/i],
};
