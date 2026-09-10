"use strict";

/**
 * @fileoverview AI Studio ClientConfig — Fixed streaming bug and race condition.
 *
 * Bug fixes:
 * 1. Race condition: stopButton gone AND doneToken visible = complete.
 *    Rating buttons are confirmation of DONE, not a trigger.
 *    (Previous bug: hasRatingBtns && !hasStopBtn → marked complete)
 * 2. Streaming first-200 bug: stableLengthThreshold=5, minPollCount=3
 *    (Previous bug: accepting first 200 chars as complete)
 */

module.exports = {
  selectors: require("./selectors.cjs"),
  completion: {
    stableLengthWindow: 4,
    stableLengthThreshold: 5, // FIX: was incorrectly accepting first 200 chars
    minPollCount: 3, // FIX: require minimum 3 stable polls
    maxTimeout: 120000,
    networkIdleMs: 2000,
  },
  validation: {
    method: "http_ping",
    targetUrl: "https://aistudio.google.com/",
    successStatus: [200, 204],
  },
  cookies: {
    requiredCookies: [{ name: "__Secure-1PAPISID" }, { name: "HSID" }],
  },
  timeout: {
    response: 120000,
    idleAfter: 5000,
  },
};
