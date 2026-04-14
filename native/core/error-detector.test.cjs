'use strict';

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
} = require('./error-detector.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
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

function makeInterceptEvent(source = 'cdp', headers = {}) {
  return { source, headers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n=== error-detector.test.cjs ===\n');

// Test 1: Priority - CDP 5xx → server_error
console.log('Test 1: CDP 5xx → server_error (highest priority)');

{
  const ctx = makeCtx({ interceptedStatus: 500 });
  const result = detectError(ctx, '', null);
  assert(result.isError === true, 'CDP 500 → isError=true');
  assert(result.errorType === 'server_error', 'errorType=server_error');
  assert(result.source === 'cdp', 'source=cdp');
  assert(result.reason === 'CDP 500 server error', 'reason correct');
}

{
  const ctx = makeCtx({ interceptedStatus: 502 });
  const result = detectError(ctx, '', null);
  assert(result.isError === true, 'CDP 502 → isError=true');
  assert(result.errorType === 'server_error', 'errorType=server_error');
}

{
  const ctx = makeCtx({ interceptedStatus: 503 });
  const result = detectError(ctx, '', null);
  assert(result.isError === true, 'CDP 503 → isError=true');
  assert(result.errorType === 'server_error', 'errorType=server_error');
}

{
  const ctx = makeCtx({ interceptedStatus: 504 });
  const result = detectError(ctx, '', null);
  assert(result.isError === true, 'CDP 504 → isError=true');
  assert(result.errorType === 'server_error', 'errorType=server_error');
}

// Test 2: Priority - CDP 401/403 → auth_error
console.log('\nTest 2: CDP 401/403 → auth_error');

{
  const ctx = makeCtx({ interceptedStatus: 401 });
  const result = detectError(ctx, '', null);
  assert(result.isError === true, 'CDP 401 → isError=true');
  assert(result.errorType === 'auth_error', 'errorType=auth_error');
  assert(result.reason === 'CDP 401 Unauthorized', 'reason correct');
}

{
  const ctx = makeCtx({ interceptedStatus: 403 });
  const result = detectError(ctx, '', null);
  assert(result.isError === true, 'CDP 403 → isError=true');
  assert(result.errorType === 'auth_error', 'errorType=auth_error');
  assert(result.reason === 'CDP 403 Forbidden', 'reason correct');
}

// Test 3: Priority - TM 5xx → server_error
console.log('\nTest 3: TM 5xx → server_error');

{
  const ctx = makeCtx({ interceptedStatus: 500 });
  const event = makeInterceptEvent('tm', {});
  const result = detectError(ctx, '', event);
  assert(result.isError === true, 'TM 500 → isError=true');
  assert(result.errorType === 'server_error', 'errorType=server_error');
  assert(result.source === 'tm', 'source=tm');
}

{
  const ctx = makeCtx({ interceptedStatus: 502 });
  const event = makeInterceptEvent('tm', {});
  const result = detectError(ctx, '', event);
  assert(result.isError === true, 'TM 502 → isError=true');
  assert(result.source === 'tm', 'source=tm');
}

// Test 4: Priority - TM 401/403 → auth_error
console.log('\nTest 4: TM 401/403 → auth_error');

{
  const ctx = makeCtx({ interceptedStatus: 401 });
  const event = makeInterceptEvent('tm', {});
  const result = detectError(ctx, '', event);
  assert(result.isError === true, 'TM 401 → isError=true');
  assert(result.errorType === 'auth_error', 'errorType=auth_error');
  assert(result.source === 'tm', 'source=tm');
}

// Test 5: source=tm correctly identified as TM (not CDP)
console.log('\nTest 5: source=tm correctly identified as TM');

{
  const ctx = makeCtx({ interceptedStatus: 500 });
  const event = makeInterceptEvent('tm', {});
  const result = detectError(ctx, '', event);
  // source=tm means TM priority matches, not CDP
  assert(result.source === 'tm', 'source=tm correctly identified');
}

// Test 6: Text content patterns (fallback)
console.log('\nTest 6: Text content patterns as fallback');

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, 'Something went wrong. Please try again.', null);
  assert(result.isError === true, 'Text with "Something went wrong" → isError=true');
  assert(result.source === 'text', 'source=text');
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, 'Server error occurred', null);
  assert(result.isError === true, 'Text with "Server error" → isError=true');
  assert(result.errorType === 'server_error', 'errorType=server_error');
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, 'Network error: connection failed', null);
  assert(result.isError === true, 'Text with "Network error" → isError=true');
  assert(result.errorType === 'network_error', 'errorType=network_error');
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, 'Request timeout occurred', null);
  assert(result.isError === true, 'Text with "timeout" → isError=true');
  assert(result.errorType === 'timeout_error', 'errorType=timeout_error');
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, 'Unauthorized access denied', null);
  assert(result.isError === true, 'Text with "Unauthorized access" → isError=true');
  assert(result.errorType === 'auth_error', 'errorType=auth_error');
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, 'Empty response from server', null);
  assert(result.isError === true, 'Text with "Empty response" → isError=true');
}

// Test 7: No error states
console.log('\nTest 7: No error states');

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectError(ctx, 'Hello, how can I help you?', null);
  assert(result.isError === false, 'Normal page → not an error');
}

{
  const ctx = makeCtx({ interceptedStatus: 301 });
  const result = detectError(ctx, 'Redirecting...', null);
  assert(result.isError === false, '301 redirect → not an error');
}

{
  const ctx = makeCtx({ interceptedStatus: 404 });
  const result = detectError(ctx, 'Page not found', null);
  assert(result.isError === false, '404 → not an error (not 5xx or 401/403)');
}

// Test 8: Client-specific patterns override defaults
console.log('\nTest 8: Client-specific patterns from config');

{
  const ctx = makeCtx({
    interceptedStatus: 200,
    config: {
      selectors: {
        errorText: [/custom\s*error\s*message/i],
      },
    },
  });
  const result = detectError(ctx, 'This is a custom error message', null);
  assert(result.isError === true, 'Custom pattern → isError=true');
  assert(result.source === 'text', 'source=text');
}

// Test 9: inferErrorTypeFromPattern
console.log('\nTest 9: inferErrorTypeFromPattern');

{
  const p = /5\d{2}|server\s*error/i;
  assert(inferErrorTypeFromPattern(p) === 'server_error', '5xx pattern → server_error');
}

{
  const p = /401|unauthorized/i;
  assert(inferErrorTypeFromPattern(p) === 'auth_error', '401 pattern → auth_error');
}

{
  const p = /network|connection/i;
  assert(inferErrorTypeFromPattern(p) === 'network_error', 'network pattern → network_error');
}

{
  const p = /timeout|etimedout/i;
  assert(inferErrorTypeFromPattern(p) === 'timeout_error', 'timeout pattern → timeout_error');
}

// Test 10: matchTextPatterns
console.log('\nTest 10: matchTextPatterns');

{
  assert(matchTextPatterns('Something went wrong').matched === true, '"Something went wrong" matches');
  assert(matchTextPatterns('server error').matched === true, '"server error" matches');
  assert(matchTextPatterns('Timeout error occurred').matched === true, '"Timeout" matches');
  assert(matchTextPatterns('Everything is fine').matched === false, 'Normal text → no match');
  assert(matchTextPatterns('').matched === false, 'Empty → false');
  assert(matchTextPatterns(null).matched === false, 'null → false');
  assert(matchTextPatterns(undefined).matched === false, 'undefined → false');
}

// Test 11: 499 (below 500, not auth) should not trigger CDP/TM error
console.log('\nTest 11: Edge case - status 499');

{
  const ctx = makeCtx({ interceptedStatus: 499 });
  const result = detectError(ctx, '', null);
  assert(result.isError === false, 'CDP 499 → not an error');
}

// Test 12: Without interceptEvent or source=undefined, 500 is treated as CDP
console.log('\nTest 12: Missing interceptEvent treats 5xx as CDP');

{
  const ctx = makeCtx({ interceptedStatus: 500 });
  // No interceptEvent → source=undefined → matches CDP priority
  const result = detectError(ctx, '', undefined);
  assert(result.isError === true, 'No interceptEvent + 500 → treated as CDP error');
  assert(result.source === 'cdp', 'source=cdp when no interceptEvent');
}

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
