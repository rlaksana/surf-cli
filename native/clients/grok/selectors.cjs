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
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button[aria-label*="Cancel"]',
  ],
  // Done token — Grok marks completion with specific text or elements
  doneToken: [
    'button[aria-label*="Regenerate"]',
    '[data-testid="grok-done"]',
    'button[aria-label*="Create"]', // image generation done
  ],
  // Rate limit text patterns
  rateLimitText: [/rate limit/i, /too many requests/i, /try again in/i, /capacity/i, /busy/i],
  // Error text patterns
  errorText: [/something went wrong/i, /error/i, /failed/i, /try again/i],
};
