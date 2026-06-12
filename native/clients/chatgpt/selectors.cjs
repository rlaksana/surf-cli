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
  // The actual response text lives here once the model finishes thinking.
  // We try multiple selectors because ChatGPT's DOM structure shifts
  // between releases; the chain keeps the strategy working when one breaks.
  markdown: [
    '.markdown',
    '[data-message-content]',
    '.prose',
  ],
  // Thinking block (for o1 / o3 / gpt-5 thinking models). The model streams
  // "thinking" tokens here first; the final answer appears in .markdown
  // after the thinking finishes. We use this to detect mid-think state.
  thinkingBlock: [
    '[data-message-model-slug*="thinking"]',
  ],
  stopButton: ['button[data-testid="stop-button"]', 'button[aria-label="Stop generating"]'],
  doneToken: [
    'div[data-testid="done"]',
    '[data-message-author-role="assistant"]',
    'button[aria-label="Copy"]',
    'button[aria-label="Read aloud"]',
  ],
  // Voice button appears once the model has finished generating
  // (stop button transforms into voice mode button).
  voiceButton: [
    'button[aria-label="Voice mode"]',
    '[data-testid="voice-mode-button"]',
  ],
  rateLimitText: [/rate limit/i, /too many requests/i, /try again in/i],
  errorText: [/something went wrong/i, /error/i, /failed/i],
};
