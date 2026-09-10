"use strict";

/**
 * @fileoverview Gemini ClientConfig — Minimal implementation, no critical bugs.
 */

module.exports = {
  selectors: require("./selectors.cjs"),
  completion: {
    stableLengthWindow: 3,
    stableLengthThreshold: 5,
    minPollCount: 2,
    maxTimeout: 60000,
    networkIdleMs: 2000,
  },
  validation: {
    method: "http_ping",
    targetUrl: "https://gemini.google.com/app",
    successStatus: [200, 204],
  },
  cookies: {
    requiredCookies: [{ name: "__Secure-1PSID" }, { name: "__Secure-1PSIDTS" }],
  },
  timeout: {
    response: 60000,
    idleAfter: 5000,
  },
};
