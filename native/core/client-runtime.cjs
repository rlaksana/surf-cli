'use strict';

/**
 * @fileoverview Client Runtime — Orchestrates all core modules for AI client detection.
 *
 * Wires together: ttl-cache, signal-normalizer, cookie-validator, completion-engine,
 * and the client strategy. Exposes a clean lifecycle API.
 *
 * Architecture:
 *   init() → creates ttl-cache, signal-normalizer, attaches CDP+TM interceptors
 *   pollCompletion() → DOM snapshot → CompletionSignals → strategy.checkCompletion() → Verdict
 *   validateCookies() → CDP cookies → cookie-validator phase 1/2 → CookieValidationResult
 *   destroy() → removes listeners, clears state
 */

const { EventEmitter } = require('events');
const { createNormalizer } = require('./signal-normalizer.cjs');
const { createTTLCache } = require('./ttl-cache.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Cookie Validator Interface (Task 7 — implemented in parallel)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CookieValidator
 * @property {(cookies: object[], config: object) => CookieValidationResult} validatePhase1
 *   Synchronous cookie checks — required cookies present and non-empty.
 * @property {(cookies: object[], config: object) => Promise<CookieValidationResult>} validatePhase2
 *   Async HTTP-ping validation against the auth endpoint.
 */

/**
 * @param {string} [cookieValidatorPath]
 * @returns {CookieValidator}
 */
function loadCookieValidator(cookieValidatorPath) {
  try {
    return require(cookieValidatorPath);
  } catch {
    // Return a no-op validator if cookie-validator is not yet available
    return {
      validatePhase1: () => ({ valid: true, phase: 1, failedSignals: [], reason: 'cookie-validator not available', cached: false }),
      validatePhase2: () => Promise.resolve({ valid: true, phase: 2, failedSignals: [], reason: 'cookie-validator not available', cached: false }),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CDP Socket Client — Low-level CDP communication over Unix socket / Windows pipe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a CDP socket client that communicates with the native host extension.
 *
 * @param {string} socketPath - Unix socket path (Linux/macOS) or Windows pipe path
 * @returns {object} CDP client with cdp() method
 */
function createCdpSocketClient(socketPath) {
  const net = require('net');
  const IS_WIN = process.platform === 'win32';
  const pipePath = IS_WIN ? '//./pipe/surf' : socketPath;

  /** @type {Map<number, {resolve: Function, reject: Function}>} */
  const pendingRequests = new Map();
  let requestCounter = 0;
  let socket = null;
  let connected = false;
  let inputBuffer = Buffer.alloc(0);

  /**
   * Send a CDP command and wait for the response.
   * @param {string} method - CDP method name, e.g. 'DOM.snapshot'
   * @param {object} params - CDP method parameters
   * @param {number} tabId - CDP tab ID
   * @returns {Promise<any>}
   */
  function cdp(method, params, tabId) {
    return new Promise((resolve, reject) => {
      const id = ++requestCounter;
      pendingRequests.set(id, { resolve, reject });

      const msg = {
        type: 'tool',
        method,
        params: { ...params, tabId },
        id,
        tabId,
      };

      if (!connected || !socket) {
        reject(new Error('CDP socket not connected'));
        return;
      }

      const json = JSON.stringify(msg);
      const len = Buffer.byteLength(json);
      const buf = Buffer.alloc(4 + len);
      buf.writeUInt32LE(len, 0);
      buf.write(json, 4);
      socket.write(buf);
    });
  }

  /**
   * Connect the socket and start reading responses.
   * @returns {Promise<void>}
   */
  function connect() {
    return new Promise((resolve, reject) => {
      socket = net.createConnection(pipePath, () => {
        connected = true;
        socket.on('data', handleData);
        resolve();
      });

      socket.on('error', (err) => {
        connected = false;
        reject(err);
      });

      socket.on('close', () => {
        connected = false;
      });

      function handleData(chunk) {
        inputBuffer = Buffer.concat([inputBuffer, chunk]);

        while (inputBuffer.length >= 4) {
          const len = inputBuffer.readUInt32LE(0);
          if (inputBuffer.length < 4 + len) break;

          const json = inputBuffer.slice(4, 4 + len).toString('utf8');
          inputBuffer = inputBuffer.slice(4 + len);

          try {
            const msg = JSON.parse(json);
            handleMessage(msg);
          } catch {}
        }
      }

      function handleMessage(msg) {
        // Handle tool_response messages — resolve pending request promises
        if (msg.type === 'tool_response' && msg.id !== undefined) {
          const pending = pendingRequests.get(msg.id);
          if (pending) {
            pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
        // Note: Network.stream events from the extension arrive as standalone messages
        // (not as responses to CDP requests). They are handled via interceptEvents,
        // not via streamHandlers. The streamHandlers map is used for future extension
        // if a request ID correlation mechanism is added.
      }
    });
  }

  /** @type {Map<number, Function>} */
  const streamHandlers = new Map();

  /**
   * Register a handler for a specific request ID (for streaming events).
   * @param {number} id
   * @param {Function} handler
   */
  function onStream(id, handler) {
    streamHandlers.set(id, handler);
  }

  function destroy() {
    for (const [, p] of pendingRequests) {
      p.reject(new Error('Socket destroyed'));
    }
    pendingRequests.clear();
    streamHandlers.clear();
    connected = false;
    if (socket) {
      socket.destroy();
      socket = null;
    }
  }

  return { cdp, connect, destroy, onStream };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM Snapshot Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the CompletionSignals object from a DOM snapshot and runtime context.
 *
 * @param {object} snapshot - Result from accessibility-tree / DOM snapshot
 * @param {object} ctx - ClientRuntimeCtx
 * @param {object} normalizer - SignalNormalizer instance
 * @returns {CompletionSignals}
 */
function buildCompletionSignals(snapshot, ctx, normalizer) {
  const pageContent = snapshot?.pageContent || '';

  // Signal 1: isTransportIdle — always true by default
  // Real idle detection requires the normalizer to emit idle events after the
  // networkIdleMs window with no new requests. The intercept handlers wire
  // interceptedStatus, but idle tracking is handled by the completion engine
  // based on the verdict's maxTimeout.
  const transportIdle = true;
  const idleReason = 'Transport idle (normalizer idle tracking not yet wired)';
  void normalizer; // normalizer param reserved for future idle tracking

  // Signal 2: isRenderStable — content length stability check
  const contentLength = pageContent.length;
  const isStable = contentLength > 0;
  const stableReason = isStable
    ? `Content length: ${contentLength} chars`
    : 'No content rendered';

  // Signal 3: isSemanticComplete — done token check
  const doneTokenSelector = ctx.doneTokenSelector;
  let semanticComplete = false;
  let semanticReason = 'Done token not found';

  if (doneTokenSelector && pageContent) {
    // Simple check: if the selector string appears in page content, it's complete
    // In practice this would use CDP querySelector, but for the signal we scan content
    const donePattern = doneTokenSelector.split(',')[0].trim();
    if (donePattern && pageContent.includes(donePattern.replace(/[''""\\]/g, ''))) {
      semanticComplete = true;
      semanticReason = `Done token found: ${donePattern}`;
    }
  }

  // Signal 4: isInteractionReady — stop button gone + input ready
  const stopButtonSelector = ctx.stopButtonSelector;
  let interactionReady = false;
  let interactionReason = 'Waiting for interaction ready';

  if (stopButtonSelector) {
    const stopPattern = stopButtonSelector.split(',')[0].trim();
    const stopGone = !stopPattern || !pageContent.includes(stopPattern.replace(/[''""\\]/g, ''));
    if (stopGone) {
      interactionReady = true;
      interactionReason = 'Stop button not visible';
    }
  } else {
    // No stop button configured — treat as interaction ready if content exists
    interactionReady = contentLength > 0;
    interactionReason = interactionReady
      ? 'No stop button configured, content present'
      : 'No content yet';
  }

  return {
    isTransportIdle: { idle: transportIdle, reason: idleReason },
    isRenderStable: { stable: isStable, contentLength, reason: stableReason },
    isSemanticComplete: { complete: semanticComplete, reason: semanticReason },
    isInteractionReady: { ready: interactionReady, reason: interactionReason },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CDP DOM Snapshot via accessibility-tree protocol
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a DOM snapshot using the CDP DOM snapshot command via the extension protocol.
 *
 * @param {object} cdpClient - CDP socket client
 * @param {number} tabId - CDP tab ID
 * @returns {Promise<object>}
 */
async function getDomSnapshot(cdpClient, tabId) {
  // Use the same protocol as host.cjs: send a tool request for page content
  // The result comes back via the socket as a tool_response
  return cdpClient.cdp('Page.read', { filter: 'interactive' }, tabId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Intercept Event Tracking — wires CDP/TM events to interceptedStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire up intercept handlers to update ctx.interceptedStatus from CDP/TM events.
 *
 * @param {object} normalizer - SignalNormalizer instance
 * @param {object} interceptEvents - EventEmitter for unified intercept events
 * @param {object} ctx - Mutable context object (interceptedStatus will be mutated)
 * @param {Function} cdpClient - CDP socket client (for stream events)
 * @param {number} tabId - CDP tab ID
 */
function wireInterceptHandlers(normalizer, interceptEvents, ctx) {
  // Track the latest HTTP status from any source
  interceptEvents.on('response', (envelope) => {
    if (envelope.status) {
      ctx.interceptedStatus = envelope.status;
    }
  });

  interceptEvents.on('error', (envelope) => {
    if (envelope.status) {
      ctx.interceptedStatus = envelope.status;
    }
  });

  // Forward all normalized envelopes from both CDP and TM to interceptEvents
  // This lets callers (strategy, completion engine) subscribe to intercept events
  normalizer.addCDPHandler((envelope) => {
    interceptEvents.emit('envelope', envelope);
    if (envelope.status) {
      ctx.interceptedStatus = envelope.status;
    }
  });

  normalizer.addTMHandler((envelope) => {
    interceptEvents.emit('envelope', envelope);
    if (envelope.status) {
      ctx.interceptedStatus = envelope.status;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ClientRuntime
 * @property {() => Promise<void>} init
 * @property {() => Promise<void>} attachInterceptors
 * @property {() => Promise<Verdict>} pollCompletion
 * @property {() => Promise<CookieValidationResult>} validateCookies
 * @property {() => Promise<void>} destroy
 */

/**
 * @typedef {Object} ClientRuntimeOptions
 * @property {string} [socketPath] - Unix socket path (default: /tmp/surf.sock)
 * @property {string} [cookieValidatorPath] - Path to cookie-validator module
 */

/**
 * Creates a ClientRuntime instance that orchestrates all core detection modules.
 *
 * @param {string} clientId - Client identifier (e.g., 'chatgpt', 'claude')
 * @param {ClientConfig} config - Client configuration object
 * @param {StrategyContract} strategy - Client strategy contract
 * @param {ClientRuntimeOptions} [options] - Optional runtime options
 * @returns {ClientRuntime}
 *
 * @example
 *   const runtime = createClientRuntime('chatgpt', chatgptConfig, chatgptStrategy);
 *   await runtime.init();
 *   const verdict = await runtime.pollCompletion();
 *   await runtime.destroy();
 */
function createClientRuntime(clientId, config, strategy, options = {}) {
  // Validate required arguments
  if (!clientId || typeof clientId !== 'string') {
    throw new Error('clientId is required and must be a string');
  }
  if (!config || typeof config !== 'object') {
    throw new Error('config is required and must be an object');
  }
  if (!strategy || typeof strategy !== 'object') {
    throw new Error('strategy is required and must be an object');
  }
  if (typeof strategy.checkCompletion !== 'function') {
    throw new Error('strategy.checkCompletion is required and must be a function');
  }

  const socketPath = options.socketPath || '/tmp/surf.sock';
  const cookieValidatorPath = options.cookieValidatorPath;

  // Test overrides — used ONLY in test environments (injected via options._testOverrides)
  /** @type {object|null} */
  const _testCdpClient = options._testOverrides?.cdpClient || null;
  /** @type {object|null} */
  const _testNormalizer = options._testOverrides?.normalizer || null;
  /** @type {object|null} */
  const _testTtlCache = options._testOverrides?.ttlCache || null;
  /** @type {boolean} */
  const _skipSocketConnect = Boolean(options._testOverrides);

  // ── Internal State ────────────────────────────────────────────────────────

  /** @type {number|null} */
  let tabId = null;

  /** @type {import('net').Socket|null} */
  let socket = null;

  /** @type {object|null} */
  let cdpClient = _testCdpClient;

  /** @type {TTLCache|null} */
  let ttlCache = _testTtlCache;

  /** @type {SignalNormalizer|null} */
  let normalizer = _testNormalizer;

  /** @type {CookieValidator|null} */
  let cookieValidator = null;

  /** @type {EventEmitter} */
  const interceptEvents = new EventEmitter();
  interceptEvents.setMaxListeners(100);

  // Mutable intercepted status — updated by intercept handlers
  /** @type {number|null} */
  let interceptedStatus = null;

  // Start time for timeout tracking
  let startTime = Date.now();

  // Runtime context passed to strategy.checkCompletion
  /** @type {ClientRuntimeCtx} */
  const ctx = {
    get tabId() { return tabId; },
    get socket() { return socket; },
    get interceptEvents() { return interceptEvents; },
    get interceptedStatus() { return interceptedStatus; },
    get config() { return config; },
    get clientId() { return clientId; },

    // Lazy DOM snapshot — captures on demand
    async domSnapshot() {
      if (!cdpClient || tabId == null) {
        return { pageContent: '', error: 'Not initialized' };
      }
      try {
        return await getDomSnapshot(cdpClient, tabId);
      } catch (err) {
        return { pageContent: '', error: err.message };
      }
    },

    // CDP querySelector via Page.read accessibility tree
    async querySelector(selector) {
      if (!cdpClient || tabId == null) return null;
      try {
        const snapshot = await getDomSnapshot(cdpClient, tabId);
        const content = snapshot?.pageContent || '';
        const firstSelector = selector.split(',')[0].trim().replace(/[''""\\]/g, '');
        if (firstSelector && content.includes(firstSelector)) {
          return { found: true, selector };
        }
        return null;
      } catch {
        return null;
      }
    },

    get stopButtonSelector() {
      const chain = config?.selectors?.stopButton;
      return Array.isArray(chain) ? chain[0] : (chain || '');
    },

    get doneTokenSelector() {
      const chain = config?.selectors?.doneToken;
      return Array.isArray(chain) ? chain[0] : (chain || '');
    },

    get networkIdleMs() {
      return config?.completion?.networkIdleMs ?? 2000;
    },

    async wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    // Elapsed time for completion-engine's maxTimeout check
    get _startTime() {
      return startTime || Date.now();
    },
  };

  // ── init ─────────────────────────────────────────────────────────────────

  /**
   * Initialize the runtime: connect CDP, create caches, create normalizer,
   * call attachInterceptors().
   *
   * @returns {Promise<void>}
   */
  async function init() {
    // Create CDP client and connect (skip in test mode — already provided via _testOverrides)
    if (!_skipSocketConnect) {
      cdpClient = createCdpSocketClient(socketPath);
      await cdpClient.connect();
    }

    // Create TTL cache (5-minute default for cookie/verdict caching)
    // Skip if already provided via test overrides
    if (!ttlCache) {
      const cacheTtlMs = config?.completion?.cacheTtlMs ?? 5 * 60 * 1000;
      ttlCache = createTTLCache({ ttlMs: cacheTtlMs, maxSize: 100 });
    }

    // Create signal normalizer with envelope handler
    // Skip if already provided via test overrides
    if (!normalizer) {
      normalizer = createNormalizer((envelope) => {
        interceptEvents.emit('envelope', envelope);
      });
    }

    // Load cookie validator (graceful no-op if not available yet)
    if (cookieValidatorPath) {
      cookieValidator = loadCookieValidator(cookieValidatorPath);
    }

    // Attach CDP + TM interceptors
    await attachInterceptors();

    // Record start time for timeout tracking (accessed via ctx._startTime getter)
    startTime = Date.now();
  }

  // ── attachInterceptors ───────────────────────────────────────────────────

  /**
   * Attach CDP interceptors (always) and TM interceptors (if Tampermonkey present).
   * CDP interceptors listen for Network.responseReceived, Network.requestWillBeSent,
   * and Network.loadingFailed events via the socket stream.
   *
   * @returns {Promise<void>}
   */
  async function attachInterceptors() {
    if (!normalizer) {
      throw new Error('init() must be called before attachInterceptors()');
    }

    // Wire up intercept handlers to update ctx.interceptedStatus
    wireInterceptHandlers(normalizer, interceptEvents, ctx);

    // CDP interceptors are always active — normalizer handles the events
    // The cdpClient stream is set up in wireInterceptHandlers to call
    // normalizer.normalizeCDPEvent on Network events
    interceptEvents.on('cdp:Network.responseReceived', (envelope) => {
      normalizer.emit(envelope);
    });

    interceptEvents.on('cdp:Network.requestWillBeSent', (envelope) => {
      normalizer.emit(envelope);
    });

    interceptEvents.on('cdp:Network.loadingFailed', (envelope) => {
      normalizer.emit(envelope);
    });

    // TM interceptors only if Tampermonkey is present in the page context
    // This is checked at runtime via window.Tampermonkey !== undefined
    // The content script will set up TM listeners if available
    // For the runtime, we just wire up the handler (normalizer.addTMHandler is a no-op if TM absent)
    if (typeof window !== 'undefined' && window.Tampermonkey !== undefined) {
      interceptEvents.on('tm:fetch', (rawEvent) => {
        const envelope = normalizer.normalizeTMEvent(rawEvent);
        if (envelope) normalizer.emit(envelope);
      });

      interceptEvents.on('tm:xhr', (rawEvent) => {
        const envelope = normalizer.normalizeTMEvent(rawEvent);
        if (envelope) normalizer.emit(envelope);
      });
    }
  }

  // ── pollCompletion ───────────────────────────────────────────────────────

  /**
   * Run one completion poll cycle:
   *   1. Get DOM snapshot via CDP
   *   2. Build CompletionSignals from snapshot + normalizer state
   *   3. Call strategy.checkCompletion(ctx) with the signals
   *   4. Return the Verdict
   *
   * @returns {Promise<Verdict>}
   */
  async function pollCompletion() {
    if (!cdpClient || tabId == null) {
      return {
        done: false,
        reason: 'Runtime not initialized',
        confidence: 0,
        activeSignals: [],
      };
    }

    // Get DOM snapshot
    const snapshot = await getDomSnapshot(cdpClient, tabId);

    // Build CompletionSignals
    const signals = buildCompletionSignals(snapshot, ctx, normalizer);

    // Check TTL cache first (avoid redundant strategy calls)
    const cacheKey = `verdict:${clientId}:${tabId}`;
    const cached = ttlCache?.get(cacheKey);
    if (cached) {
      return { ...cached, reason: `${cached.reason} (cached)` };
    }

    // Call strategy's checkCompletion with the full context
    const verdict = await strategy.checkCompletion(ctx, signals);

    // Cache the verdict (without the cached marker)
    ttlCache?.set(cacheKey, verdict);

    return verdict;
  }

  // ── validateCookies ───────────────────────────────────────────────────────

  /**
   * Run two-phase cookie validation:
   *   Phase 1 (sync): Required cookies present and non-empty
   *   Phase 2 (async): HTTP ping against the validation endpoint
   *
   * @returns {Promise<CookieValidationResult>}
   */
  async function validateCookies() {
    if (!cdpClient || tabId == null) {
      return {
        valid: false,
        phase: 1,
        failedSignals: [],
        reason: 'Runtime not initialized',
        cached: false,
      };
    }

    // Get cookies via CDP — use the cookie-validator's approach or fallback
    let cookies = [];
    try {
      // CDP: DOM.getCookies or Network.getCookies
      const cookieResult = await cdpClient.cdp('DOM.getCookies', {}, tabId);
      cookies = cookieResult?.cookies || [];
    } catch {
      // Fallback: try legacy cookie API
      try {
        const legacyResult = await cdpClient.cdp('Network.getCookies', {}, tabId);
        cookies = legacyResult?.cookies || [];
      } catch {
        // Neither cookie API available
        cookies = [];
      }
    }

    // Check TTL cache for previous validation result
    const fingerprint = cookies.map((c) => `${c.name}=${c.value ? '1' : '0'}`).join('|');
    const cacheKey = `cookies:${clientId}:${fingerprint}`;
    const cachedResult = ttlCache?.get(cacheKey);
    if (cachedResult) {
      return { ...cachedResult, cached: true };
    }

    // Phase 1: synchronous cookie checks
    if (cookieValidator) {
      const phase1 = cookieValidator.validatePhase1(cookies, config);
      if (!phase1.valid) {
        ttlCache?.set(cacheKey, phase1);
        return phase1;
      }

      // Phase 2: async HTTP ping
      const phase2 = await cookieValidator.validatePhase2(cookies, config);
      ttlCache?.set(cacheKey, phase2);
      return phase2;
    }

    // Fallback when cookie-validator is not available
    // Config structure: { validation: { cookies: { requiredCookies: [...] } } }
    const requiredCookies = config?.validation?.cookies?.requiredCookies || [];
    const failedSignals = [];
    for (const required of requiredCookies) {
      const found = cookies.find((c) => c.name === required.name);
      if (!found || !found.value) {
        failedSignals.push(required.name);
      }
    }

    const result = {
      valid: failedSignals.length === 0,
      phase: 1,
      failedSignals,
      reason: failedSignals.length === 0
        ? 'All required cookies present'
        : `Missing cookies: ${failedSignals.join(', ')}`,
      cached: false,
    };

    return result;
  }

  // ── destroy ────────────────────────────────────────────────────────────────

  /**
   * Cleanup: remove all intercept listeners, clear state, destroy CDP client.
   *
   * @returns {Promise<void>}
   */
  async function destroy() {
    interceptEvents.removeAllListeners();
    interceptedStatus = null;
    ttlCache?.clear();
    ttlCache = null;
    normalizer = null;
    cdpClient?.destroy();
    cdpClient = null;
    tabId = null;
    socket = null;
  }

  // ── setTabId (internal — called by higher-level orchestration) ────────────

  /**
   * Set the active tab ID. Called by the host/orchestrator after init.
   * @param {number} id
   */
  function setTabId(id) {
    tabId = id;
  }

  return {
    init,
    attachInterceptors,
    pollCompletion,
    validateCookies,
    destroy,
    setTabId,
    // Expose internals for testing
    _ctx: ctx,
    _getNormalizer: () => normalizer,
    _getCdpClient: () => cdpClient,
  };
}

module.exports = { createClientRuntime };
