"use strict";

/**
 * @fileoverview AI Studio DOM Selectors — Fallback chains for completion detection.
 *
 * Key bug fix: stopButton presence is the PRIMARY completion signal.
 * Rating buttons (thumbs up/down) are confirmation of DONE, NOT a trigger.
 * The previous bug was: hasRatingBtns && !hasStopBtn → marked complete (WRONG).
 */

module.exports = {
  // Response container fallback chain
  responseContainer: [
    '[data-testid="response"]',
    '[class*="response"]',
    '[class*="generation"]',
    '[role="article"]',
  ],
  // Stop button — PRIMARY completion signal (must be gone for completion)
  stopButton: [
    // Live capture 2026-09-25: the Run button slot flips to plain "Stop"
    // while streaming. Bare text first (findInContent matches tree text).
    "Stop",
    "Hentikan",
    'button[aria-label*="Stop"]',
    'button[data-testid="stop-generating"]',
    'button[class*="stop"]',
  ],
  // Done token — appears when response is fully rendered
  doneToken: [
    // Live capture 2026-09-25 done-only: Good/Bad response rating buttons,
    // View more actions. Same tokens as gemini (shared Google stack).
    "Good response",
    "Bad response",
    "View more actions",
    '[data-testid="response-done"]',
    '[data-message-author-role="assistant"]',
  ],
  // Rating buttons — confirmation of done, NOT a completion trigger
  ratingButtons: [
    'button[aria-label*="thumb"]',
    'button[aria-label*="rating"]',
    'button[class*="feedback"]',
  ],
  rateLimitText: [/rate limit/i, /too many requests/i, /quota exceeded/i, /try again in/i],
  errorText: [/something went wrong/i, /error/i, /failed/i, /could not generate/i],
};
