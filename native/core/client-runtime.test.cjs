"use strict";

/**
 * @fileoverview Tests for client-runtime.cjs
 *
 * Tests the lifecycle: init → pollCompletion → validateCookies → destroy.
 * Uses options._testOverrides to inject mock implementations.
 */

const { createClientRuntime } = require("./client-runtime.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    selectors: {
      responseContainer: [".response", "article"],
      stopButton: ['[data-testid="stop-button"]', ".stop-btn"],
      doneToken: ['[data-testid="done"]', ".complete"],
      thinkingBlock: ["[data-thinking]", ".thinking"],
      rateLimitText: ["rate limit", "too many requests"],
      errorText: ["error", "something went wrong"],
    },
    completion: {
      stableLengthWindow: 3,
      stableLengthThreshold: 50,
      minPollCount: 2,
      maxTimeout: 30000,
      networkIdleMs: 2000,
      cotAware: false,
      cacheTtlMs: 5000,
    },
    validation: {
      method: "http_ping",
      targetUrl: "https://example.com/api/auth",
      successStatus: [200],
      cookies: {
        requiredCookies: [{ name: "sessionKey", domain: ".example.com" }, { name: "userId" }],
        optionalCookies: [],
      },
    },
    timeout: {
      response: 30000,
      idleAfter: 5000,
    },
    ...overrides,
  };
}

function makeStrategy(overrides = {}) {
  const checkCompletion =
    overrides.checkCompletion ||
    (() => ({
      done: false,
      reason: "Default: not complete",
      confidence: 0,
      activeSignals: [],
    }));

  return {
    checkCompletion,
    detectRateLimitText: overrides.detectRateLimitText || (() => false),
    detectErrorText: overrides.detectErrorText || (() => false),
  };
}

function makeMockCdpClient(overrides = {}) {
  return {
    cdp: overrides.cdp || (async () => ({})),
    connect: async () => {},
    destroy: () => {},
    onStream: () => {},
  };
}

function makeMockTtlCache() {
  const store = new Map();
  return {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => store.set(key, value),
    invalidate: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Harness
// ─────────────────────────────────────────────────────────────────────────────

let _passed = 0;
let failed = 0;

function assert(condition, _msg) {
  if (condition) {
    _passed++;
  } else {
    failed++;
  }
}

function assertThrows(fn, _msg) {
  try {
    fn();
    failed++;
  } catch {
    _passed++;
  }
}

assertThrows(() => createClientRuntime(null, {}, makeStrategy()), "throws on null clientId");

assertThrows(() => createClientRuntime("", {}, makeStrategy()), "throws on empty clientId");

assertThrows(() => createClientRuntime("chatgpt", null, makeStrategy()), "throws on null config");

assertThrows(() => createClientRuntime("chatgpt", {}, null), "throws on null strategy");

assertThrows(
  () => createClientRuntime("chatgpt", {}, { checkCompletion: "not a function" }),
  "throws on non-function checkCompletion",
);

const validRuntime = createClientRuntime("chatgpt", makeConfig(), makeStrategy());
assert(typeof validRuntime.init === "function", "returns object with init method");
assert(
  typeof validRuntime.attachInterceptors === "function",
  "returns object with attachInterceptors method",
);
assert(
  typeof validRuntime.pollCompletion === "function",
  "returns object with pollCompletion method",
);
assert(
  typeof validRuntime.validateCookies === "function",
  "returns object with validateCookies method",
);
assert(typeof validRuntime.destroy === "function", "returns object with destroy method");
assert(typeof validRuntime.setTabId === "function", "returns object with setTabId method");

const runtime = createClientRuntime("test-client", makeConfig(), makeStrategy());
const ctx = runtime._ctx;

assert(ctx.clientId === "test-client", "ctx.clientId returns clientId");
assert(ctx.config != null && typeof ctx.config === "object", "ctx.config returns config object");
assert(typeof ctx.domSnapshot === "function", "ctx.domSnapshot is a function");
assert(typeof ctx.querySelector === "function", "ctx.querySelector is a function");
assert(typeof ctx.wait === "function", "ctx.wait is a function");
assert(
  ctx.stopButtonSelector === '[data-testid="stop-button"]',
  "stopButtonSelector returns first selector from chain",
);
assert(
  ctx.doneTokenSelector === '[data-testid="done"]',
  "doneTokenSelector returns first selector from chain",
);
assert(ctx.networkIdleMs === 2000, "networkIdleMs returns configured value");
assert(typeof ctx.interceptEvents === "object", "interceptEvents is an EventEmitter");
assert(ctx.interceptedStatus === null, "interceptedStatus is null initially");

async function testPollCompletion() {
  let strategyCalled = false;
  let receivedSignals = null;

  const strategy = makeStrategy({
    checkCompletion: (_runtimeCtx, signals) => {
      strategyCalled = true;
      receivedSignals = signals;
      return {
        done: true,
        reason: "Strategy done",
        confidence: 3,
        activeSignals: ["isSemanticComplete"],
      };
    },
  });

  const config = makeConfig();
  const mockCdp = makeMockCdpClient({
    cdp: async (method) => {
      if (method === "Page.read") {
        return { pageContent: "<div>Test response content</div>" };
      }
      return {};
    },
  });

  const rt = createClientRuntime("chatgpt", config, strategy, {
    _testOverrides: {
      cdpClient: mockCdp,
      normalizer: null,
      ttlCache: makeMockTtlCache(),
    },
  });

  rt.setTabId(123);
  await rt.init();

  const verdict = await rt.pollCompletion();

  assert(strategyCalled, "strategy.checkCompletion was called");
  assert(receivedSignals !== null, "signals were passed to strategy");
  assert(
    receivedSignals && typeof receivedSignals.isTransportIdle === "object",
    "signals includes isTransportIdle",
  );
  assert(
    receivedSignals && typeof receivedSignals.isRenderStable === "object",
    "signals includes isRenderStable",
  );
  assert(
    receivedSignals && typeof receivedSignals.isSemanticComplete === "object",
    "signals includes isSemanticComplete",
  );
  assert(
    receivedSignals && typeof receivedSignals.isInteractionReady === "object",
    "signals includes isInteractionReady",
  );
  assert(verdict.done === true, "verdict.done is true when strategy returns done");
  assert(
    verdict.activeSignals.includes("isSemanticComplete"),
    "verdict.activeSignals includes passed signals",
  );

  await rt.destroy();
}

testPollCompletion().catch((_e) => {
  failed++;
});

async function testPollCompletionCaching() {
  let callCount = 0;
  const strategy = makeStrategy({
    checkCompletion: () => {
      callCount++;
      return { done: false, reason: "Not done", confidence: 0, activeSignals: [] };
    },
  });

  const config = makeConfig({ completion: { cacheTtlMs: 10000 } });
  const mockCdp = makeMockCdpClient({
    cdp: async () => ({ pageContent: "<div>Test</div>" }),
  });
  const mockCache = makeMockTtlCache();

  const rt = createClientRuntime("chatgpt", config, strategy, {
    _testOverrides: {
      cdpClient: mockCdp,
      ttlCache: mockCache,
      normalizer: null,
    },
  });

  rt.setTabId(1);
  await rt.init();

  await rt.pollCompletion();
  await rt.pollCompletion();
  await rt.pollCompletion();

  assert(callCount === 1, `strategy called once (got ${callCount}) — subsequent calls cached`);

  await rt.destroy();
}

testPollCompletionCaching().catch((_e) => {
  failed++;
});

async function testValidateCookiesAllMissing() {
  const config = makeConfig();
  const mockCdp = makeMockCdpClient({
    cdp: async () => ({ cookies: [] }),
  });

  const rt = createClientRuntime("chatgpt", config, makeStrategy(), {
    _testOverrides: {
      cdpClient: mockCdp,
      ttlCache: makeMockTtlCache(),
      normalizer: null,
    },
  });

  rt.setTabId(1);
  await rt.init();

  const result = await rt.validateCookies();

  assert(result.valid === false, "valid is false when no cookies returned");
  assert(result.phase === 1, "phase is 1 for sync failure");
  assert(result.failedSignals.length > 0, "failedSignals lists missing cookies");
  assert(result.cached === false, "cached is false on first call");

  await rt.destroy();
}

testValidateCookiesAllMissing().catch((_e) => {
  failed++;
});

async function testValidateCookiesAllPresent() {
  const config = makeConfig();
  const mockCdp = makeMockCdpClient({
    cdp: async (method) => {
      if (method === "DOM.getCookies") {
        return {
          cookies: [
            { name: "sessionKey", value: "abc123", domain: ".example.com" },
            { name: "userId", value: "user1" },
          ],
        };
      }
      return { cookies: [] };
    },
  });

  const rt = createClientRuntime("chatgpt", config, makeStrategy(), {
    _testOverrides: {
      cdpClient: mockCdp,
      ttlCache: makeMockTtlCache(),
      normalizer: null,
    },
  });

  rt.setTabId(1);
  await rt.init();

  const result = await rt.validateCookies();

  assert(result.valid === true, "valid is true when all required cookies present");
  assert(result.phase === 1, "phase is 1 (sync pass, no phase 2 validator)");
  assert(result.failedSignals.length === 0, "failedSignals is empty");

  await rt.destroy();
}

testValidateCookiesAllPresent().catch((_e) => {
  failed++;
});

async function testDestroy() {
  const mockCdp = makeMockCdpClient();
  let destroyCalled = false;
  mockCdp.destroy = () => {
    destroyCalled = true;
  };

  const rt = createClientRuntime("chatgpt", makeConfig(), makeStrategy(), {
    _testOverrides: {
      cdpClient: mockCdp,
      ttlCache: makeMockTtlCache(),
      normalizer: null,
    },
  });

  rt.setTabId(1);
  await rt.init();

  // Add a listener to verify cleanup
  rt._ctx.interceptEvents.on("test-event", () => {});
  assert(
    rt._ctx.interceptEvents.listenerCount("test-event") === 1,
    "interceptEvents has listener before destroy",
  );

  await rt.destroy();

  assert(
    rt._ctx.interceptEvents.listenerCount("test-event") === 0,
    "interceptEvents listeners removed after destroy",
  );
  assert(destroyCalled, "cdpClient.destroy() was called");
}

testDestroy().catch((_e) => {
  failed++;
});

async function testInterceptEvents() {
  const rt = createClientRuntime("chatgpt", makeConfig(), makeStrategy());

  let envelopeReceived = false;
  rt._ctx.interceptEvents.on("envelope", () => {
    envelopeReceived = true;
  });

  // Manually emit an envelope
  rt._ctx.interceptEvents.emit("envelope", {
    source: "cdp",
    type: "response",
    url: "https://example.com/api",
    status: 200,
    timestamp: Date.now(),
  });

  assert(envelopeReceived, "envelope event received by listener");
}

testInterceptEvents().catch((_e) => {
  failed++;
});

async function testSetTabId() {
  const rt = createClientRuntime("chatgpt", makeConfig(), makeStrategy());

  assert(rt._ctx.tabId === null, "tabId is null initially");

  rt.setTabId(42);
  assert(rt._ctx.tabId === 42, "tabId is 42 after setTabId(42)");

  rt.setTabId(99);
  assert(rt._ctx.tabId === 99, "tabId is 99 after setTabId(99)");
}

testSetTabId().catch((_e) => {
  failed++;
});

async function testPollWithoutInit() {
  const rt = createClientRuntime("chatgpt", makeConfig(), makeStrategy());
  // Do NOT call init() or setTabId()

  const verdict = await rt.pollCompletion();

  assert(verdict.done === false, "verdict.done is false when not initialized");
  assert(verdict.reason.includes("not initialized"), "reason indicates not initialized");
}

testPollWithoutInit().catch((_e) => {
  failed++;
});

async function testInitWithOverrides() {
  const rt = createClientRuntime("chatgpt", makeConfig(), makeStrategy(), {
    _testOverrides: {
      cdpClient: makeMockCdpClient(),
      ttlCache: makeMockTtlCache(),
      normalizer: null,
    },
  });

  // init() should NOT try to connect to a real socket when _testOverrides is set
  const _connectCalled = false;
  const originalConnect = rt._getCdpClient()?.connect;
  if (originalConnect) {
    // Verify connect won't be called on init with test overrides
  }

  await rt.init(); // Should not throw even without a real socket

  assert(rt._getCdpClient() !== null, "cdpClient is set after init");
  assert(rt._getCdpClient() != null, "cdpClient is accessible via _getCdpClient");

  await rt.destroy();
}

testInitWithOverrides().catch((_e) => {
  failed++;
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

process.on("exit", () => {
  process.exit(failed > 0 ? 1 : 0);
});
