"use strict";

/**
 * @fileoverview Grok ClientConfig — Cookie-based via X.com auth.
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
    targetUrl: "https://x.com/i/grok",
    successStatus: [200, 204],
  },
  cookies: {
    requiredCookies: [{ name: "auth_token" }],
  },
  timeout: {
    response: 60000,
    idleAfter: 5000,
  },
};
