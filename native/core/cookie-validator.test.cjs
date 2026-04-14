'use strict';

/**
 * @fileoverview Tests for cookie-validator.cjs
 * Tests Phase 1 (sync) and Phase 2 (async) logic with injectable mocks.
 */

const {
  createCookieValidator,
  validatePhase1,
  validatePhase2,
  httpPing,
} = require('./cookie-validator.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal ClientRuntimeCtx for testing */
function makeCtx(tabId = 1, clientId = 'test', config = {}) {
  return {
    tabId,
    clientId,
    config: {
      cookies: { requiredCookies: [] },
      validation: {},
      ...config,
    },
    socket: /** @type {import('net').Socket} */ ({}),
  };
}

/** Minimal TTLCache for testing */
function makeCache() {
  const store = new Map();
  return {
    get: (key) => store.has(key) ? store.get(key) : null,
    set: (key, value) => store.set(key, value),
    invalidate: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

/** Fake cookie getter that returns pre-configured cookies */
function makeCookieGetter(cookies) {
  return () => Promise.resolve(cookies);
}

/** Fake cookie getter that always rejects */
function makeFailingCookieGetter(errMsg) {
  return () => Promise.reject(new Error(errMsg));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
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

function assertEqual(actual, expected, msg) {
  const cond = JSON.stringify(actual) === JSON.stringify(expected);
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log('\n=== cookie-validator.test.cjs ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 1: httpPing — invalid URL
// ─────────────────────────────────────────────────────────────────────────────

console.log('Test Group 1: httpPing — invalid URL');

httpPing({
  url: '://broken',
  cookieHeader: 'a=b',
  timeoutMs: 500,
  successStatuses: [200],
}).then((r) => {
  assertEqual(r.ok, false, 'Invalid URL → ok=false');
  assert(
    r.reason.includes('Invalid targetUrl'),
    'reason mentions "Invalid targetUrl"'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 2: httpPing — URL parsing edge cases
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 2: httpPing — URL parsing edge cases');

httpPing({
  url: 'not-a-valid-url',
  cookieHeader: 'session=abc',
  timeoutMs: 1000,
  successStatuses: [200],
}).then((r) => {
  assertEqual(r.ok, false, 'Non-URL string → ok=false');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 3: createCookieValidator — interface validation
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 3: createCookieValidator — interface validation');

{
  let threw = false;
  try {
    createCookieValidator(null, {}, makeCtx());
  } catch {
    threw = true;
  }
  assert(threw, 'Throws if cache is null');

  threw = false;
  try {
    createCookieValidator({ get: null, set: null }, {}, makeCtx());
  } catch {
    threw = true;
  }
  assert(threw, 'Throws if cache.get is not a function');

  threw = false;
  try {
    createCookieValidator(makeCache(), null, makeCtx());
  } catch {
    threw = true;
  }
  assert(threw, 'Throws if config is null');

  threw = false;
  try {
    createCookieValidator(makeCache(), {}, null);
  } catch {
    threw = true;
  }
  assert(threw, 'Throws if ctx is null');

  threw = false;
  try {
    const cv = createCookieValidator(makeCache(), makeCtx().config, makeCtx());
    assert(
      typeof cv.validatePhase1 === 'function',
      'Returns object with validatePhase1 function'
    );
    assert(
      typeof cv.validatePhase2 === 'function',
      'Returns object with validatePhase2 function'
    );
  } catch (e) {
    threw = true;
    console.log(`    Unexpected error: ${e.message}`);
  }
  assert(!threw, 'Valid inputs do not throw');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 4: validatePhase1 — no required cookies (early return)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 4: validatePhase1 — no required cookies (early return)');

{
  const ctx = makeCtx(1, 'test', {
    cookies: { requiredCookies: [] },
  });

  validatePhase1(ctx, []).then((result) => {
    assertEqual(result.valid, true, 'valid=true with empty requiredCookies');
    assertEqual(result.phase, 1, 'phase=1 for sync check');
    assertEqual(result.cached, false, 'cached=false');
    assertEqual(result.failedSignals.length, 0, 'no failed signals');
    assert(
      result.reason.includes('No required cookies configured'),
      'reason mentions no required cookies'
    );
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 5: validatePhase1 — cookie missing
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 5: validatePhase1 — cookie missing');

{
  const ctx = makeCtx(1, 'test', {
    cookies: {
      requiredCookies: [
        { name: 'sessionKey' },  // exists
        { name: 'missingCookie' }, // does NOT exist
      ],
    },
  });

  const fakeGetCookies = makeCookieGetter([
    { name: 'sessionKey', value: 'abc123' },
  ]);

  validatePhase1(ctx, ctx.config.cookies.requiredCookies, fakeGetCookies).then((result) => {
    assertEqual(result.valid, false, 'valid=false when cookie missing');
    assertEqual(result.phase, 1, 'phase=1 for sync check');
    assertEqual(result.cached, false, 'cached=false');
    assert(
      result.failedSignals.includes('missingCookie'),
      'missingCookie in failedSignals'
    );
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 6: validatePhase1 — all cookies present, no patterns
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 6: validatePhase1 — all cookies present, no patterns');

{
  const ctx = makeCtx(1, 'test', {
    cookies: {
      requiredCookies: [
        { name: 'sessionKey' },
        { name: 'authToken' },
      ],
    },
  });

  const fakeGetCookies = makeCookieGetter([
    { name: 'sessionKey', value: 'abc' },
    { name: 'authToken', value: 'xyz' },
  ]);

  validatePhase1(ctx, ctx.config.cookies.requiredCookies, fakeGetCookies).then((result) => {
    assertEqual(result.valid, true, 'valid=true when all cookies present');
    assertEqual(result.failedSignals.length, 0, 'no failed signals');
    assert(
      result.reason.includes('All required cookies present'),
      'reason confirms all present'
    );
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 7: validatePhase1 — pattern matching (match)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 7: validatePhase1 — pattern matching (match)');

{
  const ctx = makeCtx(1, 'test', {
    cookies: {
      requiredCookies: [
        { name: 'sessionKey', pattern: '^sess_' },
      ],
    },
  });

  const fakeGetCookies = makeCookieGetter([
    { name: 'sessionKey', value: 'sess_abc123xyz' },
  ]);

  validatePhase1(ctx, ctx.config.cookies.requiredCookies, fakeGetCookies).then((result) => {
    assertEqual(result.valid, true, 'valid=true when pattern matches');
    assertEqual(result.failedSignals.length, 0, 'no failed signals');
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 8: validatePhase1 — pattern matching (mismatch)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 8: validatePhase1 — pattern matching (mismatch)');

{
  const ctx = makeCtx(1, 'test', {
    cookies: {
      requiredCookies: [
        { name: 'sessionKey', pattern: '^sess_' },
      ],
    },
  });

  const fakeGetCookies = makeCookieGetter([
    { name: 'sessionKey', value: 'invalid_value' },
  ]);

  validatePhase1(ctx, ctx.config.cookies.requiredCookies, fakeGetCookies).then((result) => {
    assertEqual(result.valid, false, 'valid=false when pattern does not match');
    assert(
      result.failedSignals.includes('sessionKey'),
      'sessionKey in failedSignals'
    );
    assert(
      result.reason.includes('Missing or invalid cookies'),
      'reason mentions invalid cookies'
    );
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 9: validatePhase1 — socket/cookie retrieval error
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 9: validatePhase1 — cookie retrieval error');

{
  const ctx = makeCtx(1, 'test', {
    cookies: {
      requiredCookies: [
        { name: 'sessionKey' },
      ],
    },
  });

  const failingGetter = makeFailingCookieGetter('Socket not found. Is Chrome running?');

  validatePhase1(ctx, ctx.config.cookies.requiredCookies, failingGetter).then((result) => {
    assertEqual(result.valid, false, 'valid=false on cookie retrieval error');
    assertEqual(result.phase, 1, 'phase=1 on error');
    assert(
      result.reason.includes('Socket not found'),
      'reason mentions socket error'
    );
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 10: validatePhase2 — no validation.targetUrl
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 10: validatePhase2 — no validation.targetUrl');

{
  const cache = makeCache();
  const ctx = makeCtx(1, 'test', {
    validation: {}, // No targetUrl
    cookies: { requiredCookies: [] },
  });

  const cv = createCookieValidator(cache, ctx.config, ctx);

  cv.validatePhase2().then((result) => {
    assertEqual(result.valid, false, 'valid=false when no targetUrl');
    assertEqual(result.phase, 2, 'phase=2 when no targetUrl');
    assertEqual(result.cached, false, 'cached=false when no targetUrl');
    assert(
      result.reason.includes('No validation targetUrl'),
      'reason mentions missing targetUrl'
    );
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 11: validatePhase2 — cache hit
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 11: validatePhase2 — cache hit');

{
  const cache = makeCache();
  // Pre-populate cache with the CORRECT key (clientId:fingerprint = 'test:fp123')
  const cachedResult = {
    valid: true,
    phase: /** @type {1|2} */ (2),
    failedSignals: [],
    reason: 'Cached: HTTP 200',
    cached: false,
  };
  cache.set('test:fp123', cachedResult); // clientId='test', fingerprint='fp123'

  const ctx = makeCtx(1, 'test', {
    validation: { targetUrl: 'https://example.com/validate' },
    cookies: { requiredCookies: [] },
  });

  const cv = createCookieValidator(cache, ctx.config, ctx);

  cv.validatePhase2('fp123').then((result) => {
    assertEqual(result.cached, true, 'cached=true on cache hit');
    assertEqual(result.valid, true, 'valid=true from cache');
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 12: validatePhase2 — cache miss, cookie retrieval error
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 12: validatePhase2 — cookie retrieval error');

{
  const cache = makeCache();
  const ctx = makeCtx(1, 'test', {
    validation: { targetUrl: 'https://example.com/validate' },
    cookies: { requiredCookies: [] },
  });

  const failingGetter = makeFailingCookieGetter('Socket not found');
  const cv = createCookieValidator(cache, ctx.config, ctx, failingGetter);

  cv.validatePhase2('fp').then((result) => {
    assertEqual(result.valid, false, 'valid=false on socket error');
    assertEqual(result.phase, 2, 'phase=2 on socket error');
    assertEqual(result.cached, false, 'cached=false on error');
    assert(
      result.reason.includes('Socket not found'),
      'reason mentions socket error'
    );
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 13: CookieValidationResult shape — all fields present
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 13: CookieValidationResult — all fields present');

{
  const ctx = makeCtx(1, 'test', {
    cookies: { requiredCookies: [] },
  });

  validatePhase1(ctx, [], null).then((result) => {
    assert(
      typeof result.valid === 'boolean',
      'result.valid is boolean'
    );
    assert(
      result.phase === 1 || result.phase === 2,
      'result.phase is 1 or 2'
    );
    assert(
      Array.isArray(result.failedSignals),
      'result.failedSignals is array'
    );
    assert(
      typeof result.reason === 'string',
      'result.reason is string'
    );
    assert(
      typeof result.cached === 'boolean',
      'result.cached is boolean'
    );
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 14: Phase 1 — invalid regex pattern (should skip)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 14: Phase 1 — invalid regex pattern (skipped)');

{
  const ctx = makeCtx(1, 'test', {
    cookies: {
      requiredCookies: [
        { name: 'sessionKey', pattern: '[invalid(regex' }, // invalid regex
      ],
    },
  });

  const fakeGetCookies = makeCookieGetter([
    { name: 'sessionKey', value: 'anything' },
  ]);

  validatePhase1(ctx, ctx.config.cookies.requiredCookies, fakeGetCookies).then((result) => {
    // Invalid regex is skipped (no crash), cookie exists → valid
    assertEqual(result.valid, true, 'valid=true when invalid regex is skipped');
    assertEqual(result.failedSignals.length, 0, 'no failed signals for invalid regex');
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Group 15: createCookieValidator — passes getCookiesFn through
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nTest Group 15: createCookieValidator — getCookiesFn override works');

{
  const cache = makeCache();
  const ctx = makeCtx(1, 'test', {
    cookies: {
      requiredCookies: [
        { name: 'onlyExistsInMock' },
      ],
    },
    validation: {}, // no targetUrl
  });

  // Only exists in mock, not in real
  const mockCookies = [{ name: 'onlyExistsInMock', value: 'val' }];
  const fakeGetCookies = makeCookieGetter(mockCookies);

  const cv = createCookieValidator(cache, ctx.config, ctx, fakeGetCookies);

  cv.validatePhase1().then((result) => {
    assertEqual(result.valid, true, 'valid=true when using injected getCookiesFn');
  }).catch((err) => {
    console.log(`    Unexpected error: ${err.message}`);
    failed++;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

setTimeout(() => {
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 2000);
