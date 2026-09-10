"use strict";

/**
 * @fileoverview Claude DOM Selectors — Same as ChatGPT + thinking block for CoT.
 */

const chatgptSelectors = require("../chatgpt/selectors.cjs");

module.exports = {
  ...chatgptSelectors,
  // NOTE: avoid `[class*="thinking"]` — too greedy, matches UI chrome
  // (e.g. "thinking mode" toggle in settings). Prefer specific data-testid
  // or class names that only appear on an active thinking block.
  thinkingBlock: [
    '[data-testid="thinking-block"]',
    ".thinking-content",
    '[data-state="thinking"]',
    '[aria-busy="true"][aria-live="polite"]',
  ],
};
