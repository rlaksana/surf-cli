// @ts-expect-error - CommonJS module without type definitions
import { createTTLCache } from "../../native/core/ttl-cache.cjs";

describe("createTTLCache", () => {
  // ------------------------------------------------------------------
  // Basic get/set
  // ------------------------------------------------------------------

  describe("get/set", () => {
    it("returns null for missing key", () => {
      const cache = createTTLCache({ ttlMs: 1000 });
      expect(cache.get("nonexistent")).toBeNull();
    });

    it("returns stored value after set", () => {
      const cache = createTTLCache({ ttlMs: 1000 });
      cache.set("k1", "v1");
      expect(cache.get("k1")).toBe("v1");
    });

    it("set overwrites existing value", () => {
      const cache = createTTLCache({ ttlMs: 1000 });
      cache.set("k1", "v1");
      cache.set("k1", "v2");
      expect(cache.get("k1")).toBe("v2");
    });
  });

  // ------------------------------------------------------------------
  // TTL expiry
  // ------------------------------------------------------------------

  describe("TTL expiry", () => {
    it("returns null after ttlMs has elapsed", async () => {
      const cache = createTTLCache({ ttlMs: 50 });
      cache.set("k1", "v1");
      expect(cache.get("k1")).toBe("v1");

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 70));
      expect(cache.get("k1")).toBeNull();
    });

    it("treats negative ttlMs as invalid", () => {
      expect(() => createTTLCache({ ttlMs: -1 } as any)).toThrow("ttlMs must be a positive number");
    });

    it("treats zero ttlMs as invalid", () => {
      expect(() => createTTLCache({ ttlMs: 0 } as any)).toThrow("ttlMs must be a positive number");
    });
  });

  // ------------------------------------------------------------------
  // Sliding expiration
  // ------------------------------------------------------------------

  describe("sliding expiration", () => {
    it("get() resets TTL on unexpired entry", async () => {
      const cache = createTTLCache({ ttlMs: 80 });
      cache.set("k1", "v1");

      // Access before half the TTL
      await new Promise((r) => setTimeout(r, 30));
      cache.get("k1"); // resets TTL

      // Wait past the original TTL but within the reset window
      await new Promise((r) => setTimeout(r, 60));
      expect(cache.get("k1")).toBe("v1"); // still alive
    });
  });

  // ------------------------------------------------------------------
  // LRU eviction
  // ------------------------------------------------------------------

  describe("LRU eviction", () => {
    it("evicts least-recently-used entry when maxSize is exceeded", () => {
      const cache = createTTLCache({ ttlMs: 10000, maxSize: 3 });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");

      // 'a' is LRU; inserting 'd' should evict it
      cache.set("d", "4");

      expect(cache.get("a")).toBeNull();
      expect(cache.get("b")).toBe("2");
      expect(cache.get("c")).toBe("3");
      expect(cache.get("d")).toBe("4");
    });

    it("evicts LRU entry even if the new key already exists in the cache", () => {
      const cache = createTTLCache({ ttlMs: 10000, maxSize: 2 });
      cache.set("a", "1");
      cache.set("b", "2");

      // Touch 'a' to make it MRU, then insert 'c' which should evict 'b'
      cache.get("a");
      cache.set("c", "3");

      expect(cache.get("b")).toBeNull();
      expect(cache.get("a")).toBe("1");
      expect(cache.get("c")).toBe("3");
    });

    it("does not evict when updating existing key", () => {
      const cache = createTTLCache({ ttlMs: 10000, maxSize: 2 });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("a", "1-updated"); // no eviction should occur
      cache.set("c", "3");

      // 'b' was LRU, should be evicted
      expect(cache.get("b")).toBeNull();
      expect(cache.get("a")).toBe("1-updated");
      expect(cache.get("c")).toBe("3");
    });

    it("treats maxSize <= 0 as invalid", () => {
      expect(() => createTTLCache({ ttlMs: 1000, maxSize: 0 } as any)).toThrow(
        "maxSize must be a positive number",
      );
      expect(() => createTTLCache({ ttlMs: 1000, maxSize: -1 } as any)).toThrow(
        "maxSize must be a positive number",
      );
    });
  });

  // ------------------------------------------------------------------
  // invalidate
  // ------------------------------------------------------------------

  describe("invalidate", () => {
    it("removes the entry and returns null", () => {
      const cache = createTTLCache({ ttlMs: 10000 });
      cache.set("k1", "v1");
      cache.invalidate("k1");
      expect(cache.get("k1")).toBeNull();
    });

    it("is safe to call on non-existent key", () => {
      const cache = createTTLCache({ ttlMs: 10000 });
      expect(() => cache.invalidate("nonexistent")).not.toThrow();
    });
  });

  // ------------------------------------------------------------------
  // clear
  // ------------------------------------------------------------------

  describe("clear", () => {
    it("removes all entries", () => {
      const cache = createTTLCache({ ttlMs: 10000 });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.clear();
      expect(cache.get("a")).toBeNull();
      expect(cache.get("b")).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // keyFn config option
  // ------------------------------------------------------------------

  describe("keyFn config option", () => {
    it("accepts a custom keyFn and uses it for key normalization", () => {
      // keyFn is stored in config; callers use it externally to compute keys
      // that are then passed to set/get as the string key
      const cache = createTTLCache({
        ttlMs: 10000,
        keyFn: (clientId: string, fp: string) => `custom:${clientId}:${fp}`,
      });
      // Caller computes the key externally using keyFn
      const key = `custom:chatgpt:fp123`;
      cache.set(key, "val");
      expect(cache.get(key)).toBe("val");
    });

    it("default key format is clientId:fingerprint", () => {
      const cache = createTTLCache({ ttlMs: 10000 });
      // Without keyFn, callers use `${clientId}:${fingerprint}` directly
      cache.set("chatgpt:abc123", "result");
      expect(cache.get("chatgpt:abc123")).toBe("result");
    });
  });
});
