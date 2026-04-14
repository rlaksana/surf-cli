"use strict";

/**
 * @fileoverview Tests for error-detector.cjs
 * Priority: CDP status>=500 → TM status>=500 → textContent patterns
 * Error types: server_error, auth_error, network_error, timeout_error
 */

const {
  detectError,
  matchTextPatterns,
  inferErrorTypeFromPattern,
  DEFAULT_ERROR_PATTERNS,
} = require("./error-detector.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

let _passed = 0;
let failed = 0;

function assert(condition, _msg) {
  if (condition) {
    _passed++;
  } else {
    failed++;
  }
}

/** @param {Partial<ClientRuntimeCtx>} overrides */
function makeCtx(overrides = {}) {
  return {
    tabId: 1,
    interceptedStatus: undefined,
    config: {},
    ...overrides,
  };
}

function makeInterceptEvent(source = "cdp", headers = {}) {
  return { source, headers };
}

{
  const ctx = makeCtx({ interceptedStatus: 500 });
  const result = detectError(ctx, "", null);
  assert(result.isError === true, "CDP 500 → isError=true");
  assert(result.errorType === "server_error", "errorType=server_error");
  assert(result.source === "cdp", "source=cdp");
  assert(result.reason === "CDP 500 server error", "reason correct");
}

{
  const ctx = makeCtx({ interceptedStatus: 502 });
  const result = detectError(ctx, "", null);
  assert(result.isError === true, "CDP 502 → isError=true");
  assert(result.errorType === "server_error", "errorType=server_error");
}

{
  const ctx = makeCtx({ interceptedStatus: 503 });
  const result = detectError(ctx, "", null);
  assert(result.isError === true, "CDP 503 → isError=true");
  assert(result.errorType === "server_error", "errorType=server_error");
}

{
  const ctx = makeCtx({ interceptedStatus: 504 });
  const result = detectError(ctx, "", null);
  assert(result.isError === true, "CDP 504 → isError=true");
  assert(result.errorType === "server_error", "errorType=server_error");
}

{
  const ctx = makeCtx({ interceptedStatus: 401 });
  const result = detectError(ctx, "", null);
  assert(result.isError === true, "CDP 401 → isError=true");
  assert(result.errorType === "auth_error", "errorType=auth_error");
  assert(result.reason === "CDP 401 Unauthorized", "reason correct");
}

{
  const ctx = makeCtx({ interceptedStatus: 403 });
  const result = detectError(ctx, "", null);
  assert(result.isError === true, "CDP 403 → isError=true");
  assert(result.errorType === "auth_error", "errorType=auth_error");
  assert(result.reason === "CDP 403 Forbidden", "reason correct");
}

{
  const ctx = makeCtx({ interceptedStatus: 500 });
  const event = makeInterceptEvent("tm", {});
  const result = detectError(ctx, "", event);
  assert(result.isError === true, "TM 500 → isError=true");
  assert(result.errorType === "server_error", "errorType=server_error");
  assert(result.source === "tm", "source=tm");
}

{
  const ctx = makeCtx({ interceptedStatus: 502 });
  const event = makeInterceptEvent("tm", {});
  const result = detectError(ctx, "", event);
  assert(result.isError === true, "TM 502 → isError=true");
  assert(result.source === "tm", "source=tm");
}

{
  const ctx = makeCtx({ interceptedStatus: 401 });
  const event = makeInterceptEvent("tm", {});
  const result = detectError(ctx, "", event);
  assert(result.isError === true, "TM 401 → isError=true");
  assert(result.errorType === "auth_error", "errorType=auth_error");
  assert(result.source === "tm", "source=tm");
}

{
  const ctx = makeCtx({ interceptedStatus: 500 });
  const event = makeInterceptEvent("tm", {});
  const result = detectError(ctx, "", event);
  // source=tm means TM priority matches, not CDP
  assert(result.source === "tm", "source=tm correctly identified");
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, "Something went wrong. Please try again.", null);
  assert(result.isError === true, 'Text with "Something went wrong" → isError=true');
  assert(result.source === "text", "source=text");
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, "Server error occurred", null);
  assert(result.isError === true, 'Text with "Server error" → isError=true');
  assert(result.errorType === "server_error", "errorType=server_error");
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, "Network error: connection failed", null);
  assert(result.isError === true, 'Text with "Network error" → isError=true');
  assert(result.errorType === "network_error", "errorType=network_error");
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, "Request timeout occurred", null);
  assert(result.isError === true, 'Text with "timeout" → isError=true');
  assert(result.errorType === "timeout_error", "errorType=timeout_error");
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, "Unauthorized access denied", null);
  assert(result.isError === true, 'Text with "Unauthorized access" → isError=true');
  assert(result.errorType === "auth_error", "errorType=auth_error");
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, "Empty response from server", null);
  assert(result.isError === true, 'Text with "Empty response" → isError=true');
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, "Hello, how can I help you?", null);
  assert(result.isError === false, "Normal page → not an error");
}

{
  const ctx = makeCtx({ interceptedStatus: 301 });
  const result = detectError(ctx, "Redirecting...", null);
  assert(result.isError === false, "301 redirect → not an error");
}

{
  const ctx = makeCtx({ interceptedStatus: 404 });
  const result = detectError(ctx, "Page not found", null);
  assert(result.isError === false, "404 → not an error (not 5xx or 401/403)");
}

{
  const ctx = makeCtx({
    interceptedStatus: 200,
    config: {
      selectors: {
        errorText: [/custom\s*error\s*message/i],
      },
    },
  });
  const result = detectError(ctx, "This is a custom error message", null);
  assert(result.isError === true, "Custom pattern → isError=true");
  assert(result.source === "text", "source=text");
}

{
  const p = /5\d{2}|server\s*error/i;
  assert(inferErrorTypeFromPattern(p) === "server_error", "5xx pattern → server_error");
}

{
  const p = /401|unauthorized/i;
  assert(inferErrorTypeFromPattern(p) === "auth_error", "401 pattern → auth_error");
}

{
  const p = /network|connection/i;
  assert(inferErrorTypeFromPattern(p) === "network_error", "network pattern → network_error");
}

{
  const p = /timeout|etimedout/i;
  assert(inferErrorTypeFromPattern(p) === "timeout_error", "timeout pattern → timeout_error");
}
assert(
  matchTextPatterns("Something went wrong").matched === true,
  '"Something went wrong" matches',
);
assert(matchTextPatterns("server error").matched === true, '"server error" matches');
assert(matchTextPatterns("Timeout error occurred").matched === true, '"Timeout" matches');
assert(matchTextPatterns("Everything is fine").matched === false, "Normal text → no match");
assert(matchTextPatterns("").matched === false, "Empty → false");
assert(matchTextPatterns(null).matched === false, "null → false");
assert(matchTextPatterns(undefined).matched === false, "undefined → false");

{
  const ctx = makeCtx({ interceptedStatus: 499 });
  const result = detectError(ctx, "", null);
  assert(result.isError === false, "CDP 499 → not an error");
}

{
  const ctx = makeCtx({ interceptedStatus: 500 });
  // No interceptEvent → source=undefined → matches CDP priority
  const result = detectError(ctx, "", undefined);
  assert(result.isError === true, "No interceptEvent + 500 → treated as CDP error");
  assert(result.source === "cdp", "source=cdp when no interceptEvent");
}

if (failed > 0) {
  process.exit(1);
}
