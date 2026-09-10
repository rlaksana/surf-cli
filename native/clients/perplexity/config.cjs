"use strict";

/**
 * @fileoverview Perplexity ClientConfig — Zero required cookies, full two-phase validation.
 *
 * Phase 1 (requiredCookies=[]): trivially passes since no cookies are required.
 * Phase 2 (http_ping): still validates session via HTTP ping to perplexity session endpoint.
 */

module.exports = {
  selectors: require("./selectors.cjs"),
  completion: {
    stableLengthWindow: 3,
    stableLengthThreshold: 5,
    minPollCount: 2,
    maxTimeout: 120000,
    networkIdleMs: 2000,
  },
  validation: {
    method: "http_ping",
    targetUrl: "https://www.perplexity.ai/search",
    successStatus: [200, 204],
  },
  // Zero required cookies — Phase 1 trivially passes, Phase 2 still validates
  cookies: {
    requiredCookies: [],
  },
  timeout: {
    response: 120000,
    idleAfter: 5000,
  },
};
