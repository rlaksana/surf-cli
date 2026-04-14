"use strict";

/**
 * @fileoverview TTL Cache — Sliding-expiration LRU cache for cookie validation
 * results and completion verdicts. Backs the validation system to prevent
 * repeated HTTP pings.
 */

/**
 * @typedef {Object} TTLCache
 * @property {(key: string) => any|null} get - Get value, null if expired/missing (resets TTL on hit)
 * @property {(key: string, value: any) => void} set - Store with current timestamp
 * @property {(key: string) => void} invalidate - Remove specific key
 * @property {() => void} clear - Remove all entries
 */

/**
 * @typedef {Object} TTLCacheConfig
 * @property {number} ttlMs - Time-to-live per entry in milliseconds
 * @property {number} [maxSize=100] - Maximum number of entries before LRU eviction
 * @property {(
 *   clientId: string,
 *   fingerprint: string
 * ) => string} [keyFn] - Optional custom key factory; receives (clientId, fingerprint)
 *   and returns a cache key string. Default: `${clientId}:${fingerprint}`.
 */

/**
 * Creates a TTL cache with sliding expiration and LRU eviction.
 *
 * @param {TTLCacheConfig} config
 * @returns {TTLCache}
 */
function createTTLCache({ ttlMs, maxSize = 100, _keyFn } = {}) {
  if (typeof ttlMs !== "number" || ttlMs <= 0) {
    throw new Error("ttlMs must be a positive number");
  }
  if (typeof maxSize !== "number" || maxSize <= 0) {
    throw new Error("maxSize must be a positive number");
  }

  /** @type {Map<string, {value: any, expiresAt: number, lruOrder: number}>} */
  const store = new Map();
  let lruCounter = 0;

  /**
   * Evict the least-recently-used entry.
   */
  function evictLRU() {
    let oldest = null;
    let oldestOrder = Infinity;
    for (const [key, entry] of store) {
      if (entry.lruOrder < oldestOrder) {
        oldestOrder = entry.lruOrder;
        oldest = key;
      }
    }
    if (oldest !== null) {
      store.delete(oldest);
    }
  }

  /**
   * Get a value by key. Returns null if missing or expired.
   * Calling get() on an unexpired entry resets its TTL (sliding expiration).
   *
   * @param {string} key - Cache key
   * @returns {any|null}
   */
  function get(key) {
    const entry = store.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }

    // Sliding expiration — reset TTL on access
    entry.expiresAt = Date.now() + ttlMs;
    entry.lruOrder = lruCounter++;
    return entry.value;
  }

  /**
   * Store a value under a given key.
   *
   * @param {string} key
   * @param {any} value
   */
  function set(key, value) {
    if (store.size >= maxSize && !store.has(key)) {
      evictLRU();
    }
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      lruOrder: lruCounter++,
    });
  }

  /**
   * Remove a specific key from the cache.
   *
   * @param {string} key
   */
  function invalidate(key) {
    store.delete(key);
  }

  /**
   * Clear all entries.
   */
  function clear() {
    store.clear();
    lruCounter = 0;
  }

  return { get, set, invalidate, clear };
}

module.exports = { createTTLCache };
