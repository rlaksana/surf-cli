"use strict";

/**
 * @fileoverview AI Mode ClientConfig — Fixed cookie validation and stableCount.
 *
 * Bug fixes:
 * 1. Removed `|| cookies.length > 0` fallback — Phase 2 must validate properly
 *    Previously: hasSession || cookies.length > 0 → would pass with zero valid cookies
 *    Now: hasSession must be true (proper Google session cookie check)
 * 2. stableCount never increments was fixed in strategy.cjs
 */

module.exports = {
  selectors: require("./selectors.cjs"),
  completion: {
    stableLengthWindow: 4,
    stableLengthThreshold: 5,
    minPollCount: 3,
    maxTimeout: 120000,
    networkIdleMs: 2000,
  },
  validation: {
    method: "http_ping",
    targetUrl: "https://www.google.com/search",
    successStatus: [200, 204],
  },
  cookies: {
    requiredCookies: [
      { name: "SID" },
      { name: "HSID" },
      { name: "__Secure-1PAPISID" },
      { name: "__Secure-1PSID" },
    ],
  },
  timeout: {
    response: 120000,
    idleAfter: 5000,
  },
};
