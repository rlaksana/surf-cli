# AI Client Fix Sprint — Execution Plan

**Date:** 2026-04-14  
**Status:** Ready to execute (Session was interrupted — pick up here)

---

## Original Problem (from review)

59 issues across 7 AI clients (ChatGPT, Gemini, Grok, Perplexity, Claude, AI Studio, AI Mode).

| Severity | Count |
|----------|-------|
| Critical | 11 |
| High     | 16 |
| Medium   | 22 |
| Low      | 10 |

---

## Architecture

### Directory Structure

```
native/
  core/
    strategy-contracts.cjs   # ✅ ALREADY CREATED — interface contracts
    signal-normalizer.cjs   # TODO
    ttl-cache.cjs            # TODO
    cookie-validator.cjs     # TODO
    completion-engine.cjs     # TODO
    client-runtime.cjs        # TODO
    rate-limit-detector.cjs  # TODO
    error-detector.cjs        # TODO

  clients/
    chatgpt/
      config.cjs
      strategy.cjs
      selectors.cjs
    claude/
      config.cjs
      strategy.cjs
      selectors.cjs
    grok/
      config.cjs
      strategy.cjs
      selectors.cjs
    perplexity/
      config.cjs
      strategy.cjs
      selectors.cjs
    aistudio/
      config.cjs
      strategy.cjs
      selectors.cjs
    aimode/
      config.cjs
      strategy.cjs
      selectors.cjs
    gemini/
      config.cjs
      strategy.cjs
      selectors.cjs
```

### Tampermonkey Support
- **Runtime detection**: `if (window.Tampermonkey !== undefined)` — optional enhancement
- **Graceful degradation**: CDP-only mode if TM not installed
- **Both layers feed same SignalEnvelope pipeline**

---

## Task Dependency Chain

```
Phase 0 (sequential):
  #1 strategy-contracts ✅ DONE
        ↓
  #2 signal-normalizer [pending]

Phase 1 (parallel after #2):
  #3 ttl-cache           [pending]
  #5 completion-engine   [pending]
  #6 client-runtime      [pending]

  #3 ttl-cache → #4 cookie-validator [pending]

  #3+#4+#5+#6 → #7 reference clients [pending]

Phase 2 (after #5):
  #8 detectors (rate-limit + error) [pending]

  #8 → #9 remaining clients [pending]
```

---

## Phase 0

### Task 1: strategy-contracts.cjs ✅
- File: `native/core/strategy-contracts.cjs`
- All JSDoc typedefs: Verdict, CompletionSignals, CookieSignal, CookieValidationResult, RateLimitResult, ErrorResult, SignalEnvelope, ClientRuntimeCtx, ClientConfig, StrategyContract, TTLCache, SignalNormalizer, CompletionEngine, ClientRuntime

### Task 2: signal-normalizer.cjs
- File: `native/core/signal-normalizer.cjs`
- `createNormalizer(emitFn)` factory
- `normalizeCDPEvent(event)` — CDP Network events → SignalEnvelope
- `normalizeTMEvent(event)` — Tampermonkey fetch/XHR events → SignalEnvelope
- TM: `if (window.Tampermonkey !== undefined)` check — graceful skip if absent
- Returns: { addCDPHandler(), addTMHandler(), emit() }

---

## Phase 1

### Task 3: ttl-cache.cjs
- File: `native/core/ttl-cache.cjs`
- `createTTLCache({ ttlMs, maxSize=100, keyFn })`
- KeyFn: `${clientId}:${fingerprint}` — normalized hash, NOT raw cookie values
- Sliding expiration (get resets TTL)
- LRU eviction when maxSize exceeded

### Task 4: cookie-validator.cjs
- File: `native/core/cookie-validator.cjs`
- Phase 1 (sync): Check cookie names/patterns against config.requiredCookies
- Phase 2 (async): HTTP ping to validation.targetUrl, cache result via ttl-cache
- Result: `{ valid, phase: 1|2, failedSignals[], reason, cached }`

### Task 5: completion-engine.cjs
- File: `native/core/completion-engine.cjs`
- `run(ctx, signals) → Verdict`
- Formula: `done = (isSemanticComplete OR isInteractionReady) AND (isTransportIdle OR maxTimeout)`
- 4 signals: isTransportIdle, isRenderStable, isSemanticComplete, isInteractionReady
- All return evidence: `{ status, reason }`
- maxTimeout is first-class signal, not exception fallback

### Task 6: client-runtime.cjs
- File: `native/core/client-runtime.cjs`
- `createClientRuntime(clientId, config, strategy) → ClientRuntime`
- init(): Setup CDP, ttl-cache, signal-normalizer, attach interceptors
- attachInterceptors(): CDP always, TM if `window.Tampermonkey !== undefined`
- pollCompletion(): Collect signals, call strategy.checkCompletion(ctx)
- validateCookies(): Get cookies via CDP, run cookie-validator
- destroy(): Cleanup

### Task 7: chatgpt/ + claude/ (reference clients)
**chatgpt/** (normal UI — streaming, stop button):
- `selectors.cjs`: responseContainer, stopButton, doneToken, rateLimitText, errorText
- `config.cjs`: completion thresholds, validation endpoint, requiredCookies
- `strategy.cjs`: checkCompletion — standard streaming with stop button

**claude/** (CoT-aware — thinking blocks):
- `selectors.cjs`: same as chatgpt + thinkingBlock selector
- `config.cjs`: cotAware=true, larger stableLengthWindow (4), higher minPollCount (3)
- `strategy.cjs`: checkCompletion — if thinkingBlock visible → force continue, don't trust render-stable

---

## Phase 2

### Task 8: rate-limit-detector.cjs + error-detector.cjs
**rate-limit-detector.cjs:**
- `detectRateLimit(ctx, textContent, interceptEvent?) → RateLimitResult`
- Priority: CDP status===429 → TM 429 → textContent patterns
- Extract Retry-After header

**error-detector.cjs:**
- `detectError(ctx, textContent, interceptEvent?) → ErrorResult`
- Priority: CDP status>=500 → TM >=500 → textContent patterns
- Error types: server_error, auth_error, network_error, timeout_error

### Task 9: grok/ + perplexity/ + aistudio/ + aimode/ + gemini/
**grok/**: Response extraction via uiPatterns (needs robust fallback chain)
**perplexity/**: Zero cookie validation — implement full two-phase
**aistudio/**: Race condition fix — rating buttons as confirmation NOT trigger; streaming first-200 bug
**aimode/**: Fix || cookies.length > 0 fallback; fix stableCount never increments
**gemini/**: No criticals — minimal, verify selectors

---

## Known Bug Fixes (per client review)

| Client | Issue | Fix |
|--------|-------|-----|
| ChatGPT | Expired cookie passes check | Phase 2 HTTP ping validation |
| ChatGPT | Truncation returned as complete | Hybrid completion engine |
| ChatGPT | No CDP command retry | client-runtime retry logic |
| Perplexity | Zero cookie validation | Implement Phase 1 + 2 |
| Claude | Name-only cookie check | Add value pattern validation |
| Claude | Content stability unreliable | CoT-aware strategy |
| Grok | Brittle uiPatterns regex | Fallback chain selectors |
| Grok | Response stability false positives | Hybrid signals |
| AI Studio | Race: hasRatingBtns && !hasStopBtn | StopBtn primary, Rating confirmation |
| AI Studio | Streaming accepts first 200 | stableLengthThreshold=5, minPollCount=3 |
| Aimode | cookies.length > 0 fallback bug | Remove fallback |
| Aimode | stableCount never increments | Fix stability algorithm |

---

## Acceptance Criteria

1. No repeated validation storm under load (TTL cache works)
2. Completion false positive rate low for CoT/streaming models
3. HTTP 429/5xx caught via CDP before UI text changes
4. New client can be added without editing `core/`
5. One weird client (Claude CoT) doesn't force branching in shared core
6. Every verdict explainable via activeSignals + reason

---

## Team Structure (9 agents)

| Agent | Task | Files |
|-------|------|-------|
| A1-strategy-contracts | ✅ Done | native/core/strategy-contracts.cjs |
| A2-signal-normalizer | #2 | native/core/signal-normalizer.cjs |
| A3-ttl-cache | #3 | native/core/ttl-cache.cjs |
| A4-cookie-validator | #4 | native/core/cookie-validator.cjs |
| A5-completion-engine | #5 | native/core/completion-engine.cjs |
| A6-client-runtime | #6 | native/core/client-runtime.cjs |
| A7-reference-clients | #7 | native/clients/{chatgpt,claude}/* |
| A8-detectors | #8 | native/core/rate-limit-detector.cjs, error-detector.cjs |
| A9-remaining-clients | #9 | native/clients/{grok,perplexity,aistudio,aimode,gemini}/* |

---

## Resuming Instructions

In a new session:

1. Delete the stuck team:
   ```
   Claude Code → /team-delete surf-ai-client-fixes
   ```

2. Read this plan: `.research/ai-client-fix-sprint-plan.md`

3. Start fresh — the file `native/core/strategy-contracts.cjs` is already created.

4. Execute sequentially through the dependency chain:
   - Do Task 2 yourself (signal-normalizer — simple, ~50 lines)
   - Then spawn agents for Tasks 3-9 with task dependencies set
   - Or do all tasks sequentially if agents keep getting stuck

5. After all tasks done: E2E verification per client using `surf <client> "test query"`

**Recommended:** Do Phase 0 (Tasks 1-2) yourself in one session, then spawn agents for Phase 1+2 in the next session.
