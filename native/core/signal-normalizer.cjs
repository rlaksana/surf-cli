"use strict";

/**
 * @fileoverview Signal Normalizer — Unified event format from CDP + Tampermonkey.
 * Translates raw CDP Network events and Tampermonkey fetch/XHR events into
 * SignalEnvelope format. Both layers feed the same completion-detection pipeline.
 *
 * Usage:
 *   const normalizer = createNormalizer((envelope) => { ... });
 *   normalizer.addCDPHandler((env) => { ... });  // receive SignalEnvelope
 *   normalizer.addTMHandler((env) => { ... });   // receive SignalEnvelope
 *
 *   // When raw CDP/TM events arrive from the extension:
 *   const envelope = normalizer.normalizeCDPEvent(cdpRawEvent);
 *   if (envelope) normalizer.emit(envelope);
 */

require("./strategy-contracts.cjs");

/**
 * @typedef {Object} Normalizer
 * @property {(handler: Function) => void} addCDPHandler
 * @property {(handler: Function) => void} addTMHandler
 * @property {(envelope: SignalEnvelope) => void} emit
 * @property {(event: object) => SignalEnvelope|null} normalizeCDPEvent
 * @property {(event: object) => SignalEnvelope|null} normalizeTMEvent
 */

/**
 * @param {(envelope: SignalEnvelope) => void} emitFn - Callback to receive normalized envelopes
 * @returns {Normalizer}
 */
function createNormalizer(emitFn) {
  /** @type {Function[]} */
  const cdpHandlers = [];
  /** @type {Function[]} */
  const tmHandlers = [];

  /**
   * Normalize a raw CDP Network event into a SignalEnvelope.
   * CDP events from the extension service worker look like:
   *   { method: 'Network.responseReceived', params: { type, response: { url, status, headers } } }
   *   { method: 'Network.requestWillBeSent', params: { request: { url, method } } }
   *   { method: 'Network.loadingFailed', params: { request: { url }, errorText } }
   *
   * Only captures xhr/fetch/document response events — ignores other resource types.
   *
   * @param {object} event
   * @returns {SignalEnvelope|null}
   */
  function normalizeCDPEvent(event) {
    if (!event || !event.method) {
      return null;
    }

    const params = event.params || {};
    const now = Date.now();

    if (event.method === "Network.responseReceived") {
      const { type, response } = params;
      if (type !== "fetch" && type !== "xhr" && type !== "document") {
        return null;
      }
      return {
        source: "cdp",
        type: response.status >= 400 ? "error" : "response",
        url: response.url || "",
        status: response.status || 0,
        headers: response.headers || {},
        timestamp: now,
        method: undefined, // responseReceived doesn't carry method; rely on paired requestWillBeSent
      };
    }

    if (event.method === "Network.requestWillBeSent") {
      const { request } = params;
      return {
        source: "cdp",
        type: "request",
        url: request.url || "",
        status: undefined,
        headers: {},
        timestamp: now,
        method: request.method || "GET",
      };
    }

    if (event.method === "Network.loadingFailed") {
      const { request } = params;
      return {
        source: "cdp",
        type: "error",
        url: request.url || "",
        status: undefined,
        headers: {},
        timestamp: now,
        method: request.method || "GET",
      };
    }

    return null;
  }

  /**
   * Normalize a raw Tampermonkey fetch/XHR event into a SignalEnvelope.
   * TM events dispatched to the content script look like:
   *   { detail: { method, url, headers, status, responseHeaders } }
   *
   * Graceful no-op if Tampermonkey is not present (check at call time, not at handler registration).
   *
   * @param {object} event
   * @returns {SignalEnvelope|null}
   */
  function normalizeTMEvent(event) {
    if (typeof window !== "undefined" && window.Tampermonkey === undefined) {
      return null;
    }
    if (!event || !event.detail) {
      return null;
    }

    const d = event.detail;
    const now = Date.now();

    if (d.status !== undefined) {
      // Response event
      return {
        source: "tm",
        type: d.status >= 400 ? "error" : "response",
        url: d.url || "",
        status: d.status || 0,
        headers: d.responseHeaders || {},
        timestamp: now,
        method: d.method || "GET",
      };
    }

    if (d.method && d.url) {
      // Request event
      return {
        source: "tm",
        type: "request",
        url: d.url,
        status: undefined,
        headers: d.headers || {},
        timestamp: now,
        method: d.method,
      };
    }

    return null;
  }

  /**
   * Add a CDP handler. Handler receives normalized SignalEnvelope.
   * @param {(envelope: SignalEnvelope) => void} handler
   */
  function addCDPHandler(handler) {
    cdpHandlers.push(handler);
  }

  /**
   * Add a Tampermonkey handler. Handler receives normalized SignalEnvelope.
   * Graceful no-op if Tampermonkey is absent at call time.
   * @param {(envelope: SignalEnvelope) => void} handler
   */
  function addTMHandler(handler) {
    tmHandlers.push(handler);
  }

  /**
   * Emit a SignalEnvelope to all registered handlers and the emitFn callback.
   * @param {SignalEnvelope} envelope
   */
  function emit(envelope) {
    if (!envelope) {
      return;
    }
    for (const h of cdpHandlers) {
      try {
        h(envelope);
      } catch {
        // Swallow handler errors — resilient emit
      }
    }
    for (const h of tmHandlers) {
      try {
        h(envelope);
      } catch {
        // Swallow handler errors — resilient emit
      }
    }
    try {
      emitFn(envelope);
    } catch {
      // Swallow emit errors — resilient emit
    }
  }

  return { addCDPHandler, addTMHandler, emit, normalizeCDPEvent, normalizeTMEvent };
}

module.exports = { createNormalizer };
