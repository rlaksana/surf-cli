"use strict";

/**
 * @fileoverview Claude ClientConfig — CoT-aware tuning for thinking blocks.
 */

const chatgptConfig = require("../chatgpt/config.cjs");

module.exports = {
  ...chatgptConfig,
  selectors: require("./selectors.cjs"),
  completion: {
    ...chatgptConfig.completion,
    cotAware: true,
    stableLengthWindow: 4, // larger window for CoT stability
    minPollCount: 3, // more polls before trusting CoT
  },
};
