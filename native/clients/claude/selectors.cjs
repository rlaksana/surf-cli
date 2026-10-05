"use strict";

/**
 * @fileoverview Claude DOM Selectors — Same as ChatGPT + thinking block for CoT.
 */

const chatgptSelectors = require("../chatgpt/selectors.cjs");

module.exports = {
  ...chatgptSelectors,
  // 2026-09-25 live capture: claude.ai stop control is named "Stop response".
  // The a11y tree carries accessible names as plain text — bare-text entries
  // are what findInContent can match.
  stopButton: ["Stop response", "Stop answering", 'button[aria-label="Stop response"]'],
  // NOTE: avoid `[class*="thinking"]` — too greedy, matches UI chrome
  // (e.g. "thinking mode" toggle in settings). 2026-09-25 live capture: the
  // thinking indicator is plain a11y TEXT ("Claude is thinking" / "Mulling"),
  // not an attribute — text substrings are the reliable match here.
  thinkingBlock: [
    "Claude is thinking",
    "Mulling",
    '[data-testid="thinking-block"]',
    '[data-state="thinking"]',
  ],
  // 2026-09-25 live capture: completed assistant answers expose these action
  // buttons as accessible names (hover-independent on claude.ai).
  doneToken: ["Read aloud", "Good response", "Retry", 'button[aria-label="Copy"]'],
};
