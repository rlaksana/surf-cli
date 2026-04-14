'use strict';

/**
 * @fileoverview Cookie Validator — Two-phase cookie validation for AI client sessions.
 *
 * Phase 1 (sync): Check required cookie names/patterns against CDP cookies.
 * Phase 2 (async): HTTP ping to validation.targetUrl with session cookie, cached via TTL.
 *
 * @module cookie-validator
 */

const http = /** @type {import('http')} */ (require('http'));
const https = /** @type {import('https')} */ (require('https'));
const net = /** @type {import('net')} */ (require('net'));
const { URL } = require('url');

const {
  CookieValidationResult, // eslint-disable-line no-unused-vars
  CookieSignal, // eslint-disable-line no-unused-vars
  ClientConfig, // eslint-disable-line no-unused-vars
  ClientRuntimeCtx, // eslint-disable-line no-unused-vars
  TTLCache, // eslint-disable-line no-unused-vars
} = require('./strategy-contracts.cjs');

const SOCKET_PATH = process.platform === 'win32'
  ? '//./pipe/surf'
  : '/tmp/surf.sock';

/** Default HTTP timeout for Phase 2 validation */
const HTTP_TIMEOUT_MS = 10000;

/**
 * Retrieve all cookies for a given tab via the host socket.
 *
 * @param {number} tabId - CDP tab ID
 * @returns {Promise<Array<{name: string, value: string, domain?: string}>>}
 */
function getCookiesFromHost(tabId) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH, () => {
      const req = {
        type: 'tool_request',
        method: 'execute_tool',
        params: { tool: 'cookie.list', args: {} },
        id: 'cv-' + Date.now() + '-' + Math.random(),
        tabId,
      };
      sock.write(JSON.stringify(req) + '\n');
    });

    let buf = '';
    const timeout = setTimeout(() => {
      sock.destroy();
      reject(new Error('Cookie list request timeout'));
    }, 10000);

    sock.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);

          // Handle error responses
          if (resp.error) {
            clearTimeout(timeout);
            sock.end();
            const errText = resp.error.content?.[0]?.text
              || resp.error.message
              || JSON.stringify(resp.error);
            reject(new Error(errText));
            return;
          }

          // tool_response format: { type: 'tool_response', id, result: { cookies: [...] } }
          if (resp.type === 'tool_response' && resp.result) {
            clearTimeout(timeout);
            sock.end();

            // Extract cookies from the result — supports multiple formats
            let cookies = [];
            if (Array.isArray(resp.result.cookies)) {
              cookies = resp.result.cookies;
            } else if (resp.result.cookie && typeof resp.result.cookie === 'object') {
              cookies = [resp.result.cookie];
            } else if (Array.isArray(resp.result)) {
              cookies = resp.result;
            } else if (typeof resp.result === 'object') {
              // Fallback: try to extract any array named 'cookies'
              const arr = Object.values(resp.result).find(Array.isArray);
              if (arr) cookies = arr;
            }

            resolve(cookies);
            return;
          }

          // Extension disconnected
          if (resp.type === 'extension_disconnected') {
            clearTimeout(timeout);
            sock.end();
            reject(new Error('Extension disconnected'));
            return;
          }
        } catch (err) {
          clearTimeout(timeout);
          sock.end();
          reject(new Error('Invalid JSON from host: ' + err.message));
          return;
        }
      }
    });

    sock.on('error', (e) => {
      clearTimeout(timeout);
      if (e.code === 'ENOENT') {
        reject(new Error('Socket not found. Is Chrome running with the surf extension?'));
      } else {
        reject(e);
      }
    });

    sock.on('close', () => {
      clearTimeout(timeout);
      // If we get here without resolving, it means no valid response was received
      reject(new Error('Socket closed without response'));
    });
  });
}

/**
 * Perform an HTTP/HTTPS ping with session cookie.
 *
 * @param {{ url: string, cookieHeader: string, timeoutMs: number, successStatuses: number[] }} opts
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
function httpPing({ url, cookieHeader, timeoutMs, successStatuses }) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, reason: `Invalid targetUrl: ${url}` });
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const httpMod = isHttps ? https : http;

    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'surf-cli/1.0 cookie-validator',
      },
      timeout: timeoutMs,
    };

    const req = httpMod.request(opts, (res) => {
      const status = res.statusCode || 0;
      const ok = successStatuses.includes(status);
      res.resume(); // Drain the response body
      resolve({
        ok,
        reason: ok
          ? `HTTP ${status} — session valid`
          : `HTTP ${status} — session invalid or expired`,
      });
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        reason: `HTTP request failed: ${err.message}`,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, reason: `HTTP ping timed out after ${timeoutMs}ms` });
    });

    req.end();
  });
}

/**
 * Phase 1: Synchronous cookie name/pattern check via CDP.
 *
 * Sends COOKIE_LIST over a fresh socket connection to the host,
 * then verifies each required cookie exists and matches any value pattern.
 *
 * @param {ClientRuntimeCtx} ctx - Runtime context (tabId, config, socket)
 * @param {CookieSignal[]} requiredCookies - Required cookie specs
 * @param {function(number): Promise<Array<{name:string,value:string,domain?:string}>>} [getCookiesFn]
 *   Optional override for testability. Defaults to getCookiesFromHost.
 * @returns {Promise<CookieValidationResult>}
 */
function validatePhase1(ctx, requiredCookies, getCookiesFn) {
  const getCookies = getCookiesFn || getCookiesFromHost;

  if (!requiredCookies || requiredCookies.length === 0) {
    return Promise.resolve({
      valid: true,
      phase: /** @type {1|2} */ (1),
      failedSignals: [],
      reason: 'No required cookies configured',
      cached: false,
    });
  }

  const tabId = ctx.tabId;

  /** @type {string[]} */
  const failedSignals = [];

  return getCookies(tabId)
    .then((actualCookies) => {
      // Build a map of cookie name -> value for fast lookup
      /** @type {Map<string, string>} */
      const cookieMap = new Map();
      for (const c of actualCookies) {
        cookieMap.set(c.name, c.value || '');
      }

      for (const required of requiredCookies) {
        if (!cookieMap.has(required.name)) {
          failedSignals.push(required.name);
          continue;
        }

        if (required.pattern) {
          const value = cookieMap.get(required.name) || '';
          let regex;
          try {
            regex = new RegExp(required.pattern);
          } catch {
            // Invalid regex — skip pattern check
            continue;
          }
          if (!regex.test(value)) {
            failedSignals.push(required.name);
          }
        }
      }

      if (failedSignals.length > 0) {
        return {
          valid: false,
          phase: /** @type {1|2} */ (1),
          failedSignals,
          reason: `Missing or invalid cookies: ${failedSignals.join(', ')}`,
          cached: false,
        };
      }

      return {
        valid: true,
        phase: /** @type {1|2} */ (1),
        failedSignals: [],
        reason: 'All required cookies present',
        cached: false,
      };
    })
    .catch((err) => ({
      valid: false,
      phase: /** @type {1|2} */ (1),
      failedSignals: requiredCookies.map((c) => c.name),
      reason: `Failed to retrieve cookies: ${err.message}`,
      cached: false,
    }));
}

/**
 * Phase 2: Async HTTP ping to validation.targetUrl with session cookie.
 * Result is cached in ttl-cache (keyed by clientId + fingerprint).
 *
 * @param {ClientRuntimeCtx} ctx - Runtime context
 * @param {TTLCache} cache - TTL cache instance
 * @param {string} fingerprint - Cache key fingerprint (client-specific)
 * @param {function(number): Promise<Array<{name:string,value:string,domain?:string}>>} [getCookiesFn]
 *   Optional override for testability. Defaults to getCookiesFromHost.
 * @returns {Promise<CookieValidationResult>}
 */
function validatePhase2(ctx, cache, fingerprint, getCookiesFn) {
  const getCookies = getCookiesFn || getCookiesFromHost;
  const { config, clientId } = ctx;
  const validation = config.validation || {};

  if (!validation || !validation.targetUrl) {
    return Promise.resolve({
      valid: false,
      phase: /** @type {1|2} */ (2),
      failedSignals: [],
      reason: 'No validation targetUrl configured',
      cached: false,
    });
  }

  // Check cache first
  const cacheKey = `${clientId}:${fingerprint}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) {
    return Promise.resolve({ ...cached, cached: true });
  }

  return getCookies(ctx.tabId)
    .then((actualCookies) => {
      // Build cookie header string from all cookies
      const cookieHeader = actualCookies
        .map((c) => `${c.name}=${c.value || ''}`)
        .join('; ');

      return httpPing({
        url: validation.targetUrl,
        cookieHeader,
        timeoutMs: HTTP_TIMEOUT_MS,
        successStatuses: validation.successStatus || [200, 204],
      }).then((result) => {
        const validationResult = {
          valid: result.ok,
          phase: /** @type {1|2} */ (2),
          failedSignals: result.ok ? [] : ['http_ping'],
          reason: result.reason,
          cached: false,
        };
        cache.set(cacheKey, validationResult);
        return validationResult;
      });
    })
    .catch((err) => ({
      valid: false,
      phase: /** @type {1|2} */ (2),
      failedSignals: [],
      reason: `Failed to retrieve cookies for HTTP ping: ${err.message}`,
      cached: false,
    }));
}

/**
 * Factory: create a cookie validator bound to a specific cache, config, and runtime context.
 *
 * @param {TTLCache} cache - TTL cache for Phase 2 results
 * @param {ClientConfig} config - Client configuration (selectors, validation, cookies)
 * @param {ClientRuntimeCtx} ctx - Runtime context (tabId, socket, config, clientId)
 * @param {function(number): Promise<Array<{name:string,value:string,domain?:string}>>} [getCookiesFn]
 *   Optional cookie retrieval function override for testability.
 * @returns {{ validatePhase1: () => Promise<CookieValidationResult>, validatePhase2: (fingerprint?: string) => Promise<CookieValidationResult> }}
 */
function createCookieValidator(cache, config, ctx, getCookiesFn) {
  if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') {
    throw new Error('cache must implement TTLCache interface { get, set, invalidate, clear }');
  }
  if (!config || typeof config !== 'object') {
    throw new Error('config must be a ClientConfig object');
  }
  if (!ctx || typeof ctx !== 'object') {
    throw new Error('ctx must be a ClientRuntimeCtx object');
  }

  // Bind required cookies from config
  const requiredCookies = config.cookies?.requiredCookies || [];
  const getCookies = getCookiesFn || getCookiesFromHost;

  return {
    /**
     * Phase 1: Sync check of required cookie names/patterns against CDP cookies.
     * @returns {Promise<CookieValidationResult>}
     */
    async validatePhase1() {
      return validatePhase1(ctx, requiredCookies, getCookies);
    },

    /**
     * Phase 2: Async HTTP ping with session cookie, result cached.
     * @param {string} [fingerprint='default'] - Cache key fingerprint
     * @returns {Promise<CookieValidationResult>}
     */
    async validatePhase2(fingerprint = 'default') {
      return validatePhase2(ctx, cache, fingerprint, getCookies);
    },
  };
}

module.exports = {
  createCookieValidator,
  // Exported for testing
  validatePhase1,
  validatePhase2,
  httpPing,
  getCookiesFromHost,
};
