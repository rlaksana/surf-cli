'use strict';

/**
 * @fileoverview Error Detector — Detects errors from CDP, TM, or text patterns.
 * Priority: CDP status>=500 → TM status>=500 → textContent regex patterns.
 *
 * Error types: 'server_error' (5xx), 'auth_error' (401/403), 'network_error', 'timeout_error'.
 *
 * The ctx.interceptedStatus field carries the last CDP/TM status.
 */

const {
  ErrorResult, // eslint-disable-line no-unused-vars
} = require('./strategy-contracts.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Default error text patterns (can be overridden by client config)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {RegExp[]} */
const DEFAULT_ERROR_PATTERNS = [
  /something\s*went\s*wrong/i,
  /server\s*error/i,
  /internal\s*server\s*error/i,
  /service\s*unavailable/i,
  /bad\s*gateway/i,
  /gateway\s*timeout/i,
  /too\s*many\s*requests/i,
  /rate\s*limit/i,
  /unauthorized/i,
  /forbidden/i,
  /access\s*denied/i,
  /network\s*error/i,
  /connection\s*failed/i,
  /request\s*failed/i,
  /timeout/i,
  /etimedout/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /empty\s*response/i,
  /invalid\s*response/i,
  /unexpected\s*error/i,
  /unknown\s*error/i,
  /please\s*try\s*again/i,
  /try\s*again\s*later/i,
  /sorry\s*,?\s*something/i,
  /error\s*occurred/i,
  /failed\s*to\s*load/i,
];

/**
 * Check textContent for error patterns and return matched type.
 * @param {string} textContent
 * @param {RegExp[]} [patterns]
 * @returns {{ matched: boolean, errorType: string|null }}
 */
function matchTextPatterns(textContent, patterns = DEFAULT_ERROR_PATTERNS) {
  if (!textContent || typeof textContent !== 'string') {
    return { matched: false, errorType: null };
  }
  for (const p of patterns) {
    if (p.test(textContent)) {
      // Infer error type from pattern
      const errorType = inferErrorTypeFromPattern(p);
      return { matched: true, errorType };
    }
  }
  return { matched: false, errorType: null };
}

/**
 * Infer error type from a matched regex pattern.
 * @param {RegExp} pattern
 * @returns {string}
 */
function inferErrorTypeFromPattern(pattern) {
  const src = pattern.source;
  if (/5\d{2}|server\s*error|internal|service\s*unavailable|bad\s*gateway|gateway\s*timeout/i.test(src)) {
    return 'server_error';
  }
  if (/401|unauthorized|forbidden|access\s*denied/i.test(src)) {
    return 'auth_error';
  }
  if (/timeout|etimedout/i.test(src)) {
    return 'timeout_error';
  }
  if (/network|connection|econnreset|econnrefused|enotfound/i.test(src)) {
    return 'network_error';
  }
  return 'server_error'; // default
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Detection Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect errors from CDP status, TM status, or text content.
 *
 * Priority order:
 *   1. CDP interceptedStatus >= 500  → server_error  (source='cdp' or undefined)
 *   2. CDP interceptedStatus === 401/403 → auth_error (source='cdp' or undefined)
 *   3. TM  interceptedStatus >= 500  → server_error  (source='tm')
 *   4. TM  interceptedStatus === 401/403 → auth_error (source='tm')
 *   5. Text content patterns
 *
 * Note: interceptedStatus is shared by both CDP and TM layers. We differentiate
 * by checking interceptEvent.source to determine which layer detected the status.
 *
 * @param {ClientRuntimeCtx} ctx - Runtime context; ctx.interceptedStatus carries last status
 * @param {string} [textContent] - Page text content for pattern matching
 * @param {SignalEnvelope} [interceptEvent] - Raw intercept event for source identification
 * @returns {ErrorResult}
 */
function detectError(ctx, textContent, interceptEvent) {
  const status = ctx?.interceptedStatus;
  const source = interceptEvent?.source;

  // Priority 1: CDP status >= 500 → server_error (source is 'cdp' or undefined)
  if (status >= 500 && status < 600 && (source === 'cdp' || source === undefined)) {
    return {
      isError: true,
      errorType: 'server_error',
      source: 'cdp',
      reason: `CDP ${status} server error`,
    };
  }

  // Priority 2: CDP status 401/403 → auth_error (source is 'cdp' or undefined)
  if ((status === 401 || status === 403) && (source === 'cdp' || source === undefined)) {
    return {
      isError: true,
      errorType: 'auth_error',
      source: 'cdp',
      reason: status === 401 ? 'CDP 401 Unauthorized' : 'CDP 403 Forbidden',
    };
  }

  // Priority 3: TM status >= 500 → server_error (source is explicitly 'tm')
  if (status >= 500 && status < 600 && source === 'tm') {
    return {
      isError: true,
      errorType: 'server_error',
      source: 'tm',
      reason: `TM ${status} server error`,
    };
  }

  // Priority 4: TM status 401/403 → auth_error (source is explicitly 'tm')
  if ((status === 401 || status === 403) && source === 'tm') {
    return {
      isError: true,
      errorType: 'auth_error',
      source: 'tm',
      reason: status === 401 ? 'TM 401 Unauthorized' : 'TM 403 Forbidden',
    };
  }

  // Priority 5: Text content patterns
  const patterns = ctx?.config?.selectors?.errorText ?? DEFAULT_ERROR_PATTERNS;
  const { matched, errorType } = matchTextPatterns(textContent, patterns);
  if (matched) {
    return {
      isError: true,
      errorType: errorType || 'server_error',
      source: 'text',
      reason: `Error text pattern matched: ${errorType}`,
    };
  }

  return {
    isError: false,
    errorType: undefined,
    source: /** @type {'cdp'|'tm'|'text'} */ ('cdp'),
    reason: 'No error detected',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  detectError,
  matchTextPatterns,
  inferErrorTypeFromPattern,
  DEFAULT_ERROR_PATTERNS,
};
