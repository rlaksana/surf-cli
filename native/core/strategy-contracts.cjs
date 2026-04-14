"use strict";

/**
 * @fileoverview Strategy Contracts — Source-of-truth interface for all AI client modules.
 * All clients and all core modules MUST conform to these contracts.
 * Strict types, no `any`, no loose unions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Verdict — Every detector and strategy returns this evidence-rich result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Verdict
 * @property {boolean} done - Whether the operation/condition is complete
 * @property {string} reason - Human-readable explanation of the verdict
 * @property {number} confidence - 0-4 scale; higher = more signals confirmed
 * @property {string[]} activeSignals - Which specific signals passed
 */

/**
 * @typedef {Object} CompletionSignals
 * @property {{ idle: boolean, reason: string }} isTransportIdle - Network layer idle?
 * @property {{ stable: boolean, contentLength: number, reason: string }} isRenderStable - DOM stable?
 * @property {{ complete: boolean, reason: string }} isSemanticComplete - Client-specific done token?
 * @property {{ ready: boolean, reason: string }} isInteractionReady - Stop button gone, input ready?
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cookie Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CookieSignal
 * @property {string} name - Required cookie name
 * @property {string} [pattern] - Optional regex pattern for value validation
 * @property {string} [domain] - Optional domain restriction
 */

/**
 * @typedef {Object} CookieValidationResult
 * @property {boolean} valid - Are cookies valid?
 * @property {1|2} phase - Which phase passed/failed (1=sync, 2=async)
 * @property {string[]} failedSignals - Which cookies failed validation
 * @property {string} reason - Human-readable explanation
 * @property {boolean} cached - Was result from TTL cache?
 */

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limit & Error Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RateLimitResult
 * @property {boolean} isRateLimited - Is rate limited?
 * @property {number} [retryAfterMs] - Optional retry-after in ms
 * @property {'cdp'|'tm'|'text'} source - Which layer detected it
 * @property {string} reason - Human-readable explanation
 */

/**
 * @typedef {Object} ErrorResult
 * @property {boolean} isError - Is this an error state?
 * @property {string} [errorType] - Classification: 'server_error'|'auth_error'|'network_error'|'timeout_error'
 * @property {'cdp'|'tm'|'text'} source - Which layer detected it
 * @property {string} reason - Human-readable explanation
 */

// ─────────────────────────────────────────────────────────────────────────────
// Signal Envelope — Unified event format from CDP + Tampermonkey
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SignalEnvelope
 * @property {'cdp'|'tm'} source - Event source layer
 * @property {'response'|'request'|'error'} type - Event type
 * @property {string} url - Request URL
 * @property {number} [status] - HTTP status code (for response events)
 * @property {Object.<string, string>} [headers] - Response/request headers
 * @property {number} timestamp - Event timestamp (unix ms)
 * @property {string} [method] - HTTP method
 */

// ─────────────────────────────────────────────────────────────────────────────
// Client Runtime Context — Passed to all strategy functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ClientRuntimeCtx
 * @property {number} tabId - CDP tab ID
 * @property {import('net').Socket} socket - Unix socket to native host
 * @property {EventEmitter} interceptEvents - Unified events from CDP + TM
 * @property {() => Promise<CDPDOMSnapshot>} domSnapshot - Lazy DOM snapshot via CDP
 * @property {(selector: string) => Promise<Element|null>} querySelector - CDP query
 * @property {string} stopButtonSelector - Stop button selector from client config
 * @property {string} doneTokenSelector - Done token selector from client config
 * @property {number} networkIdleMs - Network idle threshold from config
 * @property {number|null} interceptedStatus - Last HTTP status from intercept
 * @property {(ms: number) => Promise<void>} wait - Delay utility
 * @property {ClientConfig} config - Full client config object
 * @property {string} clientId - Client identifier (e.g., 'chatgpt', 'claude')
 */

// ─────────────────────────────────────────────────────────────────────────────
// Client Config — Shape expected from each client's config.cjs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ClientConfig
 * @property {Object} selectors - DOM selectors for this client
 * @property {string[]} selectors.responseContainer - Fallback chain for response container
 * @property {string[]} selectors.stopButton - Fallback chain for stop button
 * @property {string[]} selectors.doneToken - Fallback chain for done token
 * @property {string[]} [selectors.thinkingBlock] - For CoT-aware clients (Claude)
 * @property {string[]} selectors.rateLimitText - Regex patterns for rate limit text
 * @property {string[]} selectors.errorText - Regex patterns for error text
 * @property {Object} completion - Completion thresholds
 * @property {number} completion.stableLengthWindow - Polls before declaring stable
 * @property {number} completion.stableLengthThreshold - Char variation tolerance
 * @property {number} completion.minPollCount - Minimum polls before completion
 * @property {number} completion.maxTimeout - Hard timeout in ms
 * @property {number} completion.networkIdleMs - Network idle threshold
 * @property {boolean} [completion.cotAware] - Chain-of-thought awareness flag
 * @property {Object} validation - Cookie validation config
 * @property {string} validation.method - 'http_ping'
 * @property {string} validation.targetUrl - Endpoint for Phase 2 validation
 * @property {number[]} validation.successStatus - Valid HTTP statuses
 * @property {CookieSignal[]} cookies.requiredCookies - Required cookies for Phase 1
 * @property {CookieSignal[]} [cookies.optionalCookies] - Optional cookies (warning only)
 * @property {Object} timeout - Timeout config
 * @property {number} timeout.response - Response timeout in ms
 * @property {number} timeout.idleAfter - Idle detection threshold in ms
 */

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Contract — What each client strategy.cjs must export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} StrategyContract
 * @property {(ctx: ClientRuntimeCtx) => Promise<Verdict>} checkCompletion
 *   Main completion check — called at each poll cycle.
 *   Must return evidence-rich verdict with activeSignals array.
 * @property {(textContent: string) => boolean} detectRateLimitText
 *   Check textContent for rate limit patterns.
 * @property {(textContent: string) => boolean} detectErrorText
 *   Check textContent for error patterns.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TTL Cache Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TTLCache
 * @property {(key: string) => any|null} get - Get value, null if expired/missing
 * @property {(key: string, value: any) => void} set - Store with current timestamp
 * @property {(key: string) => void} invalidate - Remove specific key
 * @property {() => void} clear - Remove all entries
 */

// ─────────────────────────────────────────────────────────────────────────────
// Signal Normalizer Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SignalNormalizer
 * @property {(handler: Function) => void} addCDPHandler - Attach CDP event handler (always works)
 * @property {(handler: Function) => void} addTMHandler - Attach TM handler (graceful no-op if TM absent)
 * @property {(envelope: SignalEnvelope) => void} emit - Manually emit a normalized envelope
 */

// ─────────────────────────────────────────────────────────────────────────────
// Completion Engine Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CompletionEngine
 * @property {(ctx: ClientRuntimeCtx, signals: CompletionSignals) => Verdict} run
 *   Evaluate all signals and return evidence-rich verdict.
 *   Formula: done = (isSemanticComplete.complete OR isInteractionReady.ready)
 *            AND (isTransportIdle.idle OR maxTimeout)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Client Runtime Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ClientRuntime
 * @property {() => Promise<void>} init - Initialize CDP connection and interceptors
 * @property {() => Promise<void>} attachInterceptors - Attach CDP + TM intercept handlers
 * @property {() => Promise<Verdict>} pollCompletion - Run one completion poll cycle
 * @property {() => Promise<CookieValidationResult>} validateCookies - Run two-phase cookie validation
 * @property {() => Promise<void>} destroy - Cleanup interceptors and state
 */

module.exports = {
  // Re-export all typedefs as a namespace for documentation
  Verdict: /** @type {typeof Verdict} */ ({}),
  CompletionSignals: /** @type {typeof CompletionSignals} */ ({}),
  CookieSignal: /** @type {typeof CookieSignal} */ ({}),
  CookieValidationResult: /** @type {typeof CookieValidationResult} */ ({}),
  RateLimitResult: /** @type {typeof RateLimitResult} */ ({}),
  ErrorResult: /** @type {typeof ErrorResult} */ ({}),
  SignalEnvelope: /** @type {typeof SignalEnvelope} */ ({}),
  ClientRuntimeCtx: /** @type {typeof ClientRuntimeCtx} */ ({}),
  ClientConfig: /** @type {typeof ClientConfig} */ ({}),
  StrategyContract: /** @type {typeof StrategyContract} */ ({}),
};
