'use strict';

/**
 * @fileoverview Tests for rate-limit-detector.cjs
 * Priority: CDP status===429 → TM status===429 → textContent patterns
 */

const {
  detectRateLimit,
  extractRetryAfter,
  matchTextPatterns,
  DEFAULT_RATE_LIMIT_PATTERNS,
} = require('./rate-limit-detector.cjs');

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

console.log('\n=== rate-limit-detector.test.cjs ===\n');

// Test 1: Priority - CDP 429
console.log('Test 1: CDP 429 has highest priority');

{
  const ctx = makeCtx({ interceptedStatus: 429 });
  const result = detectRateLimit(ctx, '', null);
  assert(result.isRateLimited === true, 'CDP 429 → isRateLimited=true');
  assert(result.source === 'cdp', 'source=cdp');
  assert(result.reason === 'CDP 429 detected', 'reason correct without Retry-After');
}

{
  const ctx = makeCtx({ interceptedStatus: 429 });
  const event = makeInterceptEvent('cdp', { 'Retry-After': '30' });
  const result = detectRateLimit(ctx, '', event);
  assert(result.isRateLimited === true, 'CDP 429 with Retry-After → isRateLimited=true');
  assert(result.retryAfterMs === 30000, 'retryAfterMs=30000 (30 seconds)');
}

// Test 2: Priority - TM 429 (only when interceptEvent source is 'tm')
console.log('\nTest 2: TM 429 priority');

{
  const ctx = makeCtx({ interceptedStatus: 429 });
  const event = makeInterceptEvent('tm', {});
  const result = detectRateLimit(ctx, '', event);
  assert(result.isRateLimited === true, 'TM 429 → isRateLimited=true');
  assert(result.source === 'tm', 'source=tm');
}

{
  const ctx = makeCtx({ interceptedStatus: 429 });
  const event = makeInterceptEvent('tm', { 'Retry-After': '120' });
  const result = detectRateLimit(ctx, '', event);
  assert(result.isRateLimited === true, 'TM 429 with Retry-After → isRateLimited=true');
  assert(result.retryAfterMs === 120000, 'retryAfterMs=120000 (120 seconds)');
}

// Test 3: Without interceptEvent or with source=undefined, 429 is treated as CDP
console.log('\nTest 3: Missing interceptEvent treats 429 as CDP');

{
  const ctx = makeCtx({ interceptedStatus: 429 });
  // No interceptEvent → source=undefined → matches CDP priority
  const result = detectRateLimit(ctx, '', undefined);
  assert(result.isRateLimited === true, 'No interceptEvent + 429 → treated as CDP');
  assert(result.source === 'cdp', 'source=cdp when no interceptEvent');
}

// Test 4: When interceptEvent.source='tm', TM priority matches (source is correctly identified)
console.log('\nTest 4: interceptEvent.source="tm" correctly identified as TM');

{
  const ctx = makeCtx({ interceptedStatus: 429 });
  // With source='tm', the TM priority matches
  const event = makeInterceptEvent('tm', {});
  const result = detectRateLimit(ctx, '', event);
  assert(result.source === 'tm', 'source=tm when interceptEvent.source is tm');
}

// Test 5: Priority - Text content patterns (fallback)
console.log('\nTest 5: Text content patterns as fallback');

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectRateLimit(ctx, 'Rate limit exceeded. Please slow down.', null);
  assert(result.isRateLimited === true, 'Text with "rate limit" → isRateLimited=true');
  assert(result.source === 'text', 'source=text');
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectRateLimit(ctx, 'Too many requests. Try again later.', null);
  assert(result.isRateLimited === true, 'Text with "too many requests" → isRateLimited=true');
}

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectRateLimit(ctx, '429', null);
  assert(result.isRateLimited === true, 'Text with "429" → isRateLimited=true');
}

// Test 6: No rate limit
console.log('\nTest 6: No rate limit');

{
  const ctx = makeCtx({ interceptedStatus: 200 });
  const result = detectRateLimit(ctx, 'Hello world, this is a normal page.', null);
  assert(result.isRateLimited === false, 'Normal page → not rate limited');
}

{
  const ctx = makeCtx({ interceptedStatus: 404 });
  const result = detectRateLimit(ctx, 'Page not found', null);
  assert(result.isRateLimited === false, '404 → not rate limited');
}

// Test 7: Client-specific patterns override defaults
console.log('\nTest 7: Client-specific patterns from config');

{
  const ctx = makeCtx({
    interceptedStatus: 200,
    config: {
      selectors: {
        rateLimitText: [/custom\s*rate\s*limit/i],
      },
    },
  });
  const result = detectRateLimit(ctx, 'You have reached your custom rate limit', null);
  assert(result.isRateLimited === true, 'Custom pattern → isRateLimited=true');
  assert(result.source === 'text', 'source=text');
}

// Test 8: extractRetryAfter
console.log('\nTest 8: extractRetryAfter');

{
  // Delta seconds
  const event = makeInterceptEvent('cdp', { 'retry-after': '60' });
  const ms = extractRetryAfter(event, 'cdp');
  assert(ms === 60000, 'Delta seconds "60" → 60000ms');
}

{
  // HTTP-date format
  const futureDate = new Date(Date.now() + 90000).toUTCString();
  const event = makeInterceptEvent('cdp', { 'Retry-After': futureDate });
  const ms = extractRetryAfter(event, 'cdp');
  assert(ms !== null && ms > 80000, `HTTP-date → parsed as ~90s (got ${ms}ms)`);
}

{
  // No header
  const event = makeInterceptEvent('cdp', {});
  const ms = extractRetryAfter(event, 'cdp');
  assert(ms === null, 'No Retry-After header → null');
}

{
  // Invalid value
  const event = makeInterceptEvent('cdp', { 'Retry-After': 'not-a-number' });
  const ms = extractRetryAfter(event, 'cdp');
  assert(ms === null, 'Invalid Retry-After → null');
}

// Test 9: matchTextPatterns
console.log('\nTest 9: matchTextPatterns');

{
  assert(matchTextPatterns('Rate limit exceeded') === true, 'Matches rate limit pattern');
  assert(matchTextPatterns('429 Too Many Requests') === true, 'Matches 429 pattern');
  assert(matchTextPatterns('Please slow down') === true, 'Matches slow down pattern');
  assert(matchTextPatterns('Everything is fine') === false, 'No match for normal text');
  assert(matchTextPatterns('') === false, 'Empty string → false');
  assert(matchTextPatterns(null) === false, 'null → false');
  assert(matchTextPatterns(undefined) === false, 'undefined → false');
}

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
