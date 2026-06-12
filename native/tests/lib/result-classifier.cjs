"use strict";

/**
 * Classify a surf CLI invocation result into PASS/FAIL with a failureKind.
 *
 * Pure function — no I/O. The runner captures {stdout, stderr, exitCode,
 * tookMs, responseLength} from `child_process.spawn` and passes it here.
 *
 * failureKind enum:
 *   - null               → PASS (response was non-empty)
 *   - "login-required"   → user must log in to that provider in Chrome
 *   - "rate-limit"       → provider throttled this user/account
 *   - "network"          → transport-layer failure (fetch/ENOTFOUND/etc)
 *   - "complete-timeout" → runner timed out waiting for response
 *   - "selector"         → response empty/garbage despite clean exit (likely UI drift)
 *   - "error"            → other non-zero exit
 */
function classify({ stdout, stderr, exitCode, tookMs, responseLength }) {
  const combined = `${stdout}\n${stderr}`.toLowerCase();

  // PASS: non-empty response, exit 0
  if (exitCode === 0 && responseLength > 0) {
    return { status: "PASS", failureKind: null };
  }

  // Detect transient categories BEFORE generic ones (so login-required
  // doesn't get masked by "error" classification).
  if (combined.includes("login required") || combined.includes("login check failed")) {
    return { status: "FAIL", failureKind: "login-required" };
  }
  if (
    combined.includes("rate limit") ||
    combined.includes("429") ||
    combined.includes("too many requests")
  ) {
    return { status: "FAIL", failureKind: "rate-limit" };
  }
  if (
    combined.includes("fetch failed") ||
    combined.includes("enotfound") ||
    combined.includes("etimedout") ||
    combined.includes("econnreset")
  ) {
    return { status: "FAIL", failureKind: "network" };
  }

  // Complete-timeout: hit our 90s wall (exit 124 = timeout from `timeout` cmd)
  if (tookMs >= 90000 || exitCode === 124) {
    return { status: "FAIL", failureKind: "complete-timeout" };
  }

  // Selector: clean exit but response is empty/garbage ("Done" only)
  if (exitCode === 0 && responseLength === 0) {
    return { status: "FAIL", failureKind: "selector" };
  }

  return { status: "FAIL", failureKind: "error" };
}

module.exports = { classify };
