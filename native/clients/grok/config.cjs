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
    // Grok moved from x.com to grok.com. Try grok.com first; legacy x.com
    // is still valid for users who haven't migrated.
    targetUrl: "https://grok.com/",
    successStatus: [200, 204],
  },
  cookies: {
    // Grok moved from x.com to grok.com as the primary domain. The cookie
    // validator scans the current tab's domain, so we accept either path.
    // If surf-cli is on a grok.com tab, check the grok.com cookie namespace;
    // if on x.com, the legacy auth_token cookie.
    requiredCookies: [
      { name: "auth_token" },
      { name: "grok_session" },
      { name: "session_id" },
    ],
    allowedDomains: ["grok.com", "x.com"],
  },
  timeout: {
    response: 60000,
    idleAfter: 5000,
  },
};
