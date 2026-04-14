"use strict";

/**
 * @fileoverview ChatGPT ClientConfig — Tuning for the normal streaming UI.
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
    targetUrl: "https://chatgpt.com/api/auth/session",
    successStatus: [200, 204],
  },
  cookies: {
    requiredCookies: [
      { name: "access_token" },
      { name: "session_key", pattern: /[a-zA-Z0-9-_]{20,}/ },
    ],
  },
  timeout: {
    response: 60000,
    idleAfter: 5000,
  },
};
