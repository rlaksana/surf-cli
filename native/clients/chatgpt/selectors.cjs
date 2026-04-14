"use strict";

/**
 * @fileoverview ChatGPT DOM Selectors — Fallback chains for completion detection.
 * First match wins; iterate through array until a selector finds a visible element.
 */

module.exports = {
  responseContainer: [
    'div[data-testid="conversation-turn"]',
    ".conversation-turn",
    '[role="article"]',
  ],
  stopButton: ['button[data-testid="stop-button"]', 'button[aria-label="Stop generating"]'],
  doneToken: ['div[data-testid="done"]', '[data-message-author-role="assistant"]'],
  rateLimitText: [/rate limit/i, /too many requests/i, /try again in/i],
  errorText: [/something went wrong/i, /error/i, /failed/i],
};
