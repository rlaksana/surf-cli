'use strict';

/**
 * @fileoverview Rate Limit Detector — Detects rate limiting from CDP, TM, or text patterns.
 * Priority: CDP status===429 → TM status===429 → textContent regex patterns.
 *
 * The ctx.interceptedStatus field carries the last CDP/TM status.
 * Retry-After header is extracted and converted to ms.
 */

const {
  RateLimitResult, // eslint-disable-line no-unused-vars
} = require('./strategy-contracts.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Default rate-limit text patterns (can be overridden by client config)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {RegExp[]} */
const DEFAULT_RATE_LIMIT_PATTERNS = [
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /429/i,
  /slow\s*down/i,
  /retry\s*after/i,
  /try\s*again\s*later/i,
  /quota\s*exceeded/i,
  /max\s*requests/i,
];

/**
 * Check textContent for rate-limit patterns.
 * @param {string} textContent
 * @param {RegExp[]} [patterns]
 * @returns {boolean}
 */
function matchTextPatterns(textContent, patterns = DEFAULT_RATE_LIMIT_PATTERNS) {
  if (!textContent || typeof textContent !== 'string') return false;
  return patterns.some((p) => p.test(textContent));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Detection Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect rate limiting from CDP status, TM status, or text content.
 *
 * Priority order:
 *   1. CDP interceptedStatus === 429  (interceptEvent.source === 'cdp' or undefined)
 *   2. TM  interceptedStatus === 429  (interceptEvent.source === 'tm')
 *   3. Text content patterns
 *
 * Note: interceptedStatus is shared by both CDP and TM layers. We differentiate
 * by checking interceptEvent.source to determine which layer detected the status.
 *
 * @param {ClientRuntimeCtx} ctx - Runtime context; ctx.interceptedStatus carries last status
 * @param {string} [textContent] - Page text content for pattern matching
 * @param {SignalEnvelope} [interceptEvent] - Raw intercept event for header access and source identification
 * @returns {RateLimitResult}
 */
function detectRateLimit(ctx, textContent, interceptEvent) {
  const status = ctx?.interceptedStatus;
  const source = interceptEvent?.source;

  // Priority 1: CDP status === 429 (source is 'cdp' or undefined)
  if (status === 429 && (source === 'cdp' || source === undefined)) {
    const retryAfterMs = extractRetryAfter(interceptEvent, 'cdp');
    return {
      isRateLimited: true,
      retryAfterMs: retryAfterMs !== null ? retryAfterMs : undefined,
      source: 'cdp',
      reason: retryAfterMs !== null
        ? `CDP 429 with Retry-After: ${retryAfterMs}ms`
        : 'CDP 429 detected',
    };
  }

  // Priority 2: TM status === 429 (source is explicitly 'tm')
  if (status === 429 && source === 'tm') {
    const retryAfterMs = extractRetryAfter(interceptEvent, 'tm');
    return {
      isRateLimited: true,
      retryAfterMs: retryAfterMs !== null ? retryAfterMs : undefined,
      source: 'tm',
      reason: retryAfterMs !== null
        ? `TM 429 with Retry-After: ${retryAfterMs}ms`
        : 'TM 429 detected',
    };
  }

  // Priority 3: Text content patterns
  const patterns = ctx?.config?.selectors?.rateLimitText ?? DEFAULT_RATE_LIMIT_PATTERNS;
  if (matchTextPatterns(textContent, patterns)) {
    return {
      isRateLimited: true,
      retryAfterMs: undefined,
      source: 'text',
      reason: 'Rate limit text pattern matched',
    };
  }

  return {
    isRateLimited: false,
    retryAfterMs: undefined,
    source: /** @type {'cdp'|'tm'|'text'} */ ('cdp'),
    reason: 'No rate limit detected',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Extract Retry-After Header
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract and parse Retry-After header into milliseconds.
 * Supports: Delta seconds (integer) and HTTP-date (RFC 7231).
 *
 * @param {SignalEnvelope} [event] - Intercept event carrying headers
 * @param {'cdp'|'tm'} [source]
 * @returns {number|null} - Parsed retry-after in ms, or null if not present/invalid
 */
function extractRetryAfter(event, source) {
  if (!event?.headers) return null;

  const headerKey = Object.keys(event.headers).find(
    (k) => k.toLowerCase() === 'retry-after'
  );
  if (!headerKey) return null;

  const value = event.headers[headerKey];
  if (!value) return null;

  // Try parsing as delta seconds first
  const deltaSec = parseInt(value, 10);
  if (!isNaN(deltaSec)) {
    return deltaSec * 1000;
  }

  // Try parsing as HTTP-date (RFC 7231)
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const deltaMs = date.getTime() - Date.now();
    return deltaMs > 0 ? deltaMs : null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  detectRateLimit,
  extractRetryAfter,
  matchTextPatterns,
  DEFAULT_RATE_LIMIT_PATTERNS,
};
