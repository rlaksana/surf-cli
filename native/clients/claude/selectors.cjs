"use strict";

/**
 * @fileoverview Claude DOM Selectors — Same as ChatGPT + thinking block for CoT.
 */

const chatgptSelectors = require("../chatgpt/selectors.cjs");

module.exports = {
  ...chatgptSelectors,
  thinkingBlock: ['[data-testid="thinking-block"]', ".thinking-content", '[class*="thinking"]'],
};
