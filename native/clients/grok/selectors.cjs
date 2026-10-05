"use strict";

/**
 * @fileoverview Grok DOM Selectors — Fallback chains for response extraction.
 * Response extraction uses a robust fallback chain since uiPatterns regex is brittle.
 * First match wins in each chain.
 */

module.exports = {
  // Fallback chain for response container — Grok renders in article/conversation elements
  responseContainer: [
    'article[data-testid="grok-response"]',
    '[data-testid="conversation"] article',
    'article[aria-label*="Grok"]',
    '[data-testid="grok-article"]',
    "main article",
  ],
  // Stop button indicates response is still generating
  stopButton: [
    // Bare accessible names (findInContent matches a11y tree text only).
    // Live capture 2026-09-25 (browser locale id): 'Hentikan respons model';
    // English fallbacks included for en-locale browsers.
    "Hentikan respons",
    "Stop response",
    "Stop generating",
    'button[aria-label*="Stop"]',
    'button[aria-label*="Cancel"]',
  ],
  // Done token — Grok marks completion with specific text or elements
  doneToken: [
    // Live capture 2026-09-25 done-only: Regenerate, 'Salin respons' (id),
    // 'Buat link berbagi' (id), Edit, More actions.
    "Regenerate",
    "Salin respons",
    "Copy response",
    "Buat link berbagi",
    "Create share link",
    'button[aria-label*="Regenerate"]',
    '[data-testid="grok-done"]',
    'button[aria-label*="Create"]', // image generation done
  ],
  // Rate limit text patterns
  rateLimitText: [/rate limit/i, /too many requests/i, /try again in/i, /capacity/i, /busy/i],
  // Error text patterns
  errorText: [/something went wrong/i, /error/i, /failed/i, /try again/i],
};
