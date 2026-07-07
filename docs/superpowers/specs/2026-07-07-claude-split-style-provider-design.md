# Add Claude as a Split-Style AI Provider

**Date:** 2026-07-07
**Status:** Draft (awaiting user review)
**Author:** Surf brainstorming session (user + Claude)

## Problem

`surf claude "PONG"` fails with `Error: Unknown tool: claude` (verified in
`.research/ai-smoke-2026-07-07T04-16-46-553Z/report.json`). Claude is a
legitimate first-class provider in this repo's history — `native/claude-client.cjs`,
`native/host.cjs` `CLAUDE_QUERY` handler, `native/host-helpers.cjs` `case "claude"`,
and `native/cli.cjs` dispatch were all added by `d54804f chore: sanitize workspace
& snapshot code` (2026-03-11) — but the upstream merge `909c51d` resolved
conflicts in favor of upstream, which never had Claude, and the dispatch
disappeared from `host.cjs`, `host-helpers.cjs`, and `cli.cjs`. The legacy
`claude-client.cjs` survived because it was a new file with no upstream
equivalent.

The current tree has **two Claude implementations, neither wired**:

| File | Lines | Status |
|---|---|---|
| `native/claude-client.cjs` | 346 | Legacy monolithic CDP client, **unwired** |
| `native/clients/claude/config.cjs` | 18 | Split-style config, **unwired** |
| `native/clients/claude/selectors.cjs` | 20 | Split-style selectors, **unwired** |
| `native/clients/claude/strategy.cjs` | 187 | Split-style CoT-aware strategy, **unwired** |
| `dist/service-worker/` Claude handlers | — | **Never existed** |

Compounding this, the split-style architecture itself is **dead code across all
7 providers**. `native/core/client-runtime.cjs` (777 lines, 469 lines of tests)
exposes `createClientRuntime()` but **has zero call sites**. `native/core/` also
has 5 other modules (`completion-engine`, `signal-normalizer`, `cookie-validator`,
`rate-limit-detector`, `error-detector`, `ttl-cache`, `strategy-contracts`) totaling
~1500 lines of well-tested infrastructure that nothing calls. The split-style
sprint `27d7f55 feat(sprint): complete AI client architecture sprint` shipped
the scaffolding but no provider ever used it.

Finally, **Claude.ai's live UI has drifted from the selector chains in both
implementations**, captured 2026-07-07 via page-agent MCP against a logged-in
Pro plan session:

| Selector | Expected match | Live result |
|---|---|---|
| `textarea[placeholder*="How can I help you"]` | composer | **NOT FOUND** — composer is contenteditable, not textarea |
| `textarea[placeholder*="message"]` | composer | **NOT FOUND** |
| `#composer-input` | composer | **NOT FOUND** |
| `[data-testid="composer-input"]` | composer | **NOT FOUND** |
| `div[contenteditable="true"][role="textbox"]` | composer | **FOUND** — `aria-label="Write your prompt to Claude"` |
| `button[aria-label="Send message"]` | send | **NOT FOUND** — no button exists |
| `button[data-testid="send-button"]` | send | **NOT FOUND** |
| `button[type="submit"]` | send | **NOT FOUND** |
| `[data-is-streaming]`, `.font-claude-response`, `[data-turn-author="assistant"]`, `[data-testid="assistant-message"]`, `.claude-message` | response | unverified (idle state only — page-agent cannot dispatch Enter) |
| `[data-testid="stop-button"]`, `button[aria-label="Stop"]`, `button[aria-label="Stop generating"]` | stop | unverified (idle state) |
| `[data-testid="thinking-block"]`, `.thinking-content`, `[data-state="thinking"]`, `[aria-busy="true"]` | thinking | unverified (idle state) |

The legacy `claude-client.cjs:SELECTORS` chain (10-19) is **half dead** on
composer + send, and **unverified** on response/stop/thinking.

## Goal

Add Claude as a working AI provider in `surf`, accessible as `surf claude "..."`,
that passes the `npm run test:ai` PONG smoke test. Use the **split-style
architecture** (`native/clients/claude/`) as the first provider to actually
exercise the previously-dormant `createClientRuntime` infrastructure. Delete
the legacy monolithic `native/claude-client.cjs` to avoid carrying two
implementations of the same provider.

Out of scope:

- Migrating the other 6 providers (chatgpt, gemini, perplexity, grok, aistudio,
  aimode) to the split-style architecture. That is a follow-up decision that
  needs its own brainstorm and its own evidence.
- Selector recovery for streaming-state selectors (assistant-message, stop-button,
  thinking-block) when the live UI has not been observed streaming. This work
  will be done as part of the implementation, driven by `npm run test:ai` and
  the `CLAUDE.md` selector-recovery playbook. This spec only locks down the
  composer (idle state) selectors and the send path.
- Cookies hardening. The legacy `hasRequiredCookies` accepts `session`,
  `anthropic-device-id`, or `ARID`. Only `sessionKey` is correct for
  claude.ai web (the other two are Anthropic API cookies). The implementation
  will narrow this — the spec does not pin the exact list, but the smoke test
  will reveal what works against the live page.
- Council skill, file upload, image attachment, voice mode interaction. None
  of these are documented requirements. YAGNI.
- Continuous monitoring / scheduling. The PONG smoke test is the verification
  loop.

## Architecture: Split-Style Client + Hybrid Runtime

### The shim: `native/clients/claude/client.cjs` (new)

A thin module that:

1. **Wires the runtime** for completion detection:
   ```js
   const { createClientRuntime } = require("../../core/client-runtime.cjs");
   const config = require("./config.cjs");
   const strategy = require("./strategy.cjs");
   const runtime = createClientRuntime("claude", config, strategy);
   ```

2. **Exposes `query(options)` matching the contract every other provider uses**
   (see `native/chatgpt-client.cjs` for the contract shape). The host's
   `handleToolRequest` already knows how to call this shape.

3. **Bridges the runtime to the host's helper-closure pattern.** The runtime
   speaks CDP over `/tmp/surf.sock` directly. The host passes in `getCookies`,
   `createTab`, `closeTab`, `cdpEvaluate`, `cdpCommand`, `log` via the
   `options` argument. The shim **uses host's helpers for tab/cookie/eval/command
   lifecycle** (the proven pattern, used by all 6 other providers), and **uses
   the runtime only for completion polling** (the part Claude is weakest at,
   per `9c387f3 fix(ai-clients): ChatGPT thinking model + Claude/Perplexity
   selector fixes`).

   This hybrid keeps the shim small (~150-200 lines), reuses the runtime for
   its intended purpose (signal-based completion detection), and avoids
   re-implementing tab/cookie/eval/command plumbing that host.cjs already
   handles for the other 6 providers.

4. **Returns the canonical response shape**:
   ```js
   { response: string, model: string, tookMs: number }
   ```
   to match `chatgptClient.query`, `geminiClient.query`, etc.

### The existing split-style modules: keep, with selector updates

- **`native/clients/claude/config.cjs`** (18 lines): already extends
  `chatgpt/config.cjs`, overrides `selectors` and `completion` (`cotAware: true`).
  **No change needed** unless cookie list is updated — that's a follow-up.

- **`native/clients/claude/selectors.cjs`** (20 lines): **update** the
  `promptTextarea` and `sendButton` chains. The composer chain must lead
  with `div[contenteditable="true"][role="textbox"]` (verified FOUND). The
  `sendButton` chain is **removed** (the click path doesn't submit; Enter
  key dispatch is the correct path, already in legacy `claude-client.cjs:185-202`).
  Streaming-state selectors (`responseContainer`, `stopButton`, `doneToken`,
  `thinkingBlock`) **stay as-is** for the first implementation; smoke-test
  failure will drive iteration.

- **`native/clients/claude/strategy.cjs`** (187 lines): already implements
  CoT-aware `checkCompletion` with thinking-block guard, rate-limit detection,
  and error detection. **No change needed** for this work; the strategy is
  the value of the split-style architecture.

### The host: `native/host.cjs`

Add the require and the dispatch, mirroring the existing chatgpt pattern
(`host.cjs:482-545`) but adapted for Claude (no file upload):

1. **Require** the new shim:
   ```js
   const claudeClient = require("./clients/claude/client.cjs");
   ```

2. **Add `case "CLAUDE_QUERY"`** to `handleToolRequest`, ~80 lines:
   - `getCookies` → `GET_CLAUDE_COOKIES` message
   - `createTab` → `CLAUDE_NEW_TAB` message (URL: `https://claude.ai/`)
   - `closeTab` → `CLAUDE_CLOSE_TAB` message
   - `cdpEvaluate` → `CLAUDE_EVALUATE` message
   - `cdpCommand` → `CLAUDE_CDP_COMMAND` message
   - All messages are routed through `pendingToolRequests` / `writeMessage`
     exactly like chatgpt.
   - Return shape: `{ response, model, tookMs }`.

### The message router: `native/host-helpers.cjs`

Add `case "claude"` to `mapToolToMessage` (~10 lines, mirror chatgpt at
`host-helpers.cjs:1068-1077`):

```js
case "claude":
  if (!a.query) throw new Error("query required");
  return {
    type: "CLAUDE_QUERY",
    query: a.query,
    model: a.model,
    withPage: a["with-page"],
    timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 300000,
    ...baseMsg
  };
```

### The CLI: `native/cli.cjs`

Three additions, all mirror chatgpt/aimode patterns:

1. **`TOOLS` help entry** (around `cli.cjs:387-500`): add a `claude` block
   with `desc`, `args: ["query"]`, `opts: { model, timeout, "with-page" }`,
   and 3 examples (basic, with-page, model override).

2. **`PRIMARY_ARG_MAP`**: add `claude: "query"`.

3. **`AI_TOOLS` array**: add `"claude"` to the existing array.

### The service worker: `src/service-worker/index.ts`

Add 5 cases + 1 allow-list entry, mirroring `CHATGPT_NEW_TAB` /
`CHATGPT_CLOSE_TAB` / `CHATGPT_CDP_COMMAND` / `CHATGPT_EVALUATE` /
`GET_CHATGPT_COOKIES` (`service-worker/index.ts:3093-3149`):

- `case "CLAUDE_NEW_TAB"`: open `https://claude.ai/` in background, wait
  for `status === "complete"`, attach CDP, wait for runtime ready. Note:
  recent commit `f8a0250 fix(service-worker): open AI provider tabs in
  background, do not steal focus` applies — use `active: false`.
- `case "CLAUDE_CLOSE_TAB"`: detach CDP, remove tab. Mirror
  `CHATGPT_CLOSE_TAB` at `service-worker/index.ts:3127-3138`.
- `case "CLAUDE_CDP_COMMAND"`: `cdp.sendCommand(...)`. Mirror
  `CHATGPT_CDP_COMMAND` at `service-worker/index.ts:3140-3144`.
- `case "CLAUDE_EVALUATE"`: `cdp.evaluateScript(...)`. Mirror
  `CHATGPT_EVALUATE` at `service-worker/index.ts:3146-3148`.
- `case "GET_CLAUDE_COOKIES"`: `chrome.cookies.getAll({ domain: ".claude.ai" })`.
  **This is the only non-trivial deviation** — chatgpt's
  `GET_CHATGPT_COOKIES` is handler-specific; Claude needs the same pattern
  but for the claude.ai domain. Implementation mirrors the chatgpt handler.

Also add the 5 message types to the `allowedMessages` / message-allow-list
at `service-worker/index.ts:3582-3588`.

### The legacy client: delete

After the shim is wired and verified, **delete `native/claude-client.cjs`**
(346 lines). This is a one-line removal. Reversible via git if needed.
Justification: carrying two implementations of the same provider invites
future drift and confuses readers.

## Data Flow

End-to-end trace for `surf claude "PONG"`:

```
CLI (cli.cjs)
  ↓ writes JSON to /tmp/surf.sock
Native Host (host.cjs → handleToolRequest)
  ↓ recognizes "claude" tool
  ↓ calls claudeClient.query({ prompt, getCookies, createTab, ... })
Shim (clients/claude/client.cjs)
  ↓ createClientRuntime('claude', config, strategy) → runtime.init()
  ↓ getCookies() → GET_CLAUDE_COOKIES → service-worker → returns cookies
  ↓ createTab() → CLAUDE_NEW_TAB → service-worker → returns tabId
  ↓ typing: cdpEvaluate + cdpCommand (Input.insertText, Enter keydown)
  ↓ polling: runtime.pollCompletion() in a loop with timeout
    ↓ domSnapshot via CDP accessibility tree
    ↓ strategy.checkCompletion(ctx, signals) → CoT-aware verdict
    ↓ returns Verdict { done, reason, confidence, activeSignals }
  ↓ closeTab() → CLAUDE_CLOSE_TAB
  ↓ runtime.destroy()
  ↓ returns { response, model, tookMs }
Native Host (host.cjs)
  ↓ returns result via writeMessage
CLI (cli.cjs)
  ↓ prints response.text
```

## Error Handling

The shim must handle these failure modes, each with a distinct `failureKind`
string the smoke test can classify:

| Failure | failureKind | Detection |
|---|---|---|
| Login required (no claude.ai session cookies) | `login-required` | `hasRequiredCookies` returns false |
| Prompt composer never appears | `error` | `waitForPromptReady` timeout |
| Click send does not submit | `error` | page-state check (composer still has text) |
| Response never completes | `complete-timeout` | `runtime.pollCompletion` returns done:false at `maxTimeout` |
| Response selector misses content | `selector` | `response.length === 0` after `done:true` |
| Claude rate-limits the user | `rate-limit` | `rateLimitDetector` matches `pageContent` |
| Claude returns a server error | `error` | `errorDetector` matches `pageContent` |
| CDP/extension disconnect | `error` | `cdpEvaluate` / `cdpCommand` throws |

The smoke test (`native/tests/ai-provider-smoke.cjs`) already classifies
these — see `2026-06-12-ai-provider-stability-test-design.md` for the
classification contract. No new failure modes are introduced.

## Testing Strategy

### Unit tests (in `test/unit/claude-client.test.ts`)

The shim is small (~150-200 lines) and pure orchestration, but its bridge
between host helpers and the runtime is the riskiest part. Mock the
`createClientRuntime` factory and assert the shim calls it with the right
`clientId`, `config`, `strategy`, and options. Cover:

- `query()` calls `runtime.init()` exactly once.
- `query()` calls `runtime.pollCompletion()` until `done:true` or timeout.
- `query()` calls `runtime.destroy()` in `finally`.
- `query()` returns the runtime's response wrapped in `{ response, model, tookMs }`.
- `query()` rejects with a clear error if `hasRequiredCookies` returns false.
- `query()` rejects with a clear error if `createTab` fails to return a tabId.
- `query()` does **not** leak the tab — `closeTab` is always called, even on
  error, with a 5s timeout (mirroring `claude-client.cjs:367-371`).

Mock the `host` helper closures so the unit tests don't need a real socket.

### Integration test: `npm run test:ai`

The existing PONG smoke test (`native/tests/ai-provider-smoke.cjs`) already
iterates all 7 providers including Claude. The implementation is "done" when:

1. `npm run test:ai` runs to completion without erroring on the dispatch path
   (currently errors with `Error: Unknown tool: claude` in 60ms).
2. Claude's `failureKind` is **not** `error` or `selector` — those indicate
   wiring bugs. `login-required` is acceptable for CI runs without a session
   cookie; the smoke test should treat that as PASS-with-warning.
3. The other 6 providers do not regress (the change is additive).

### Live verification: page-agent MCP

When the smoke test fails with `kind=selector` or `kind=complete-timeout`,
the diagnostic loop is the same as the existing `CLAUDE.md` selector-recovery
playbook, with page-agent MCP as the browser-driving surface:

1. User runs `npm run test:ai`; Claude fails.
2. User invokes page-agent MCP to navigate to `https://claude.ai/new` in a
   fresh tab.
3. Page-agent reports the live DOM (a limitation we hit: page-agent cannot
   dispatch Enter; for streaming-state selectors, the user will need to
   manually send a prompt in a parallel tab and have page-agent snapshot
   the streaming DOM, or use `surf js "..."` for direct `Runtime.evaluate`
   via the native host's socket).
4. Diff the snapshot against `selectors.cjs`; update selectors; rerun smoke.

This is the recovery loop the user already has. The implementation does
not change the recovery loop — it only makes the initial wiring land on
the right baseline (composer contenteditable, send via Enter).

## Risks

1. **First-mover risk on `createClientRuntime`.** No other provider uses the
   runtime, so any runtime bug that doesn't surface in its 469-line unit
   suite will hit Claude first. Mitigation: the shim's unit tests mock
   `createClientRuntime`, so the runtime is exercised only at integration
   time. The smoke test catches regressions.

2. **Streaming-state selector drift.** Page-agent could not capture
   streaming DOM (no Enter dispatch). The first smoke test run will reveal
   whether the current `assistant-message` / `stop-button` / `thinking-block`
   selectors in `selectors.cjs` still match. If they don't, the
   `CLAUDE.md` selector-recovery playbook applies.

3. **Cookies hardening.** The legacy `hasRequiredCookies` accepts cookies
   that don't apply to claude.ai web (`anthropic-device-id`, `ARID`). The
   implementation will narrow this to claude.ai session cookies. If too
   narrow, smoke test fails with `login-required` and we widen; if too
   broad, we accept false positives and tighten.

4. **Service-worker message types are added but unverified in a logged-in
   Chrome session.** The implementation can compile and lint clean without
   a live browser. The smoke test is the only real validation. If the
   user can't run `npm run test:ai` interactively, the implementation may
   ship broken.

5. **The architecture question is deferred, not resolved.** Other providers
   (chatgpt, gemini, perplexity, grok, aistudio, aimode) stay on legacy.
   The split-style architecture's 3000 lines stay half-dormant. This is
   intentional per the user's selection of Option B, but it means a future
   "migrate all 7 providers" sprint is still needed.

6. **Page-agent MCP can't drive Enter or evaluate JS in this environment.**
   The implementation will compile and the smoke test will run, but the
   user (not the AI agent) is the one driving the live browser during
   selector recovery. That's a real friction, not a blocker.

## Success Criteria

The implementation is complete when:

- [ ] `npm run build` produces a host.cjs that includes the Claude dispatch.
- [ ] `npm run check` and `npm run lint` pass clean.
- [ ] `npm run test -- test/unit/claude-client.test.ts` passes the new
      shim unit tests.
- [ ] `npm run test:ai` runs the Claude case and either:
      - returns a non-empty `response` containing "PONG" (ideal), or
      - fails with `failureKind: login-required` (acceptable: no
        session cookie in CI), or
      - fails with `failureKind: selector` (acceptable: surfaces the
        recovery loop, which the user drives via page-agent MCP).
- [ ] `surf claude --help` shows the same help shape as `surf chatgpt --help`.
- [ ] `native/claude-client.cjs` is deleted.
- [ ] No new files in `dist/` reference removed types or symbols.

## Open Questions

None for this spec. The cookie list, streaming-state selectors, and any
remaining gaps will be resolved during implementation via the smoke test
+ selector-recovery loop.

## Follow-up Work (deferred, not in scope)

- Migrate the other 6 providers to split-style. Pre-condition: this
  implementation proves `createClientRuntime` works on a real chat workload.
- Decide what to do with the 7 other `native/clients/<name>/` directories
  (chatgpt, gemini, perplexity, grok, aistudio, aimode) — keep as-is,
  migrate, or delete.
- Replace `native/core/cookie-validator.cjs` HTTP-ping validation with
  the new `GET_CLAUDE_COOKIES` + `hasRequiredCookies` flow used in legacy
  `claude-client.cjs` (or vice versa — the two patterns are not consistent
  across the codebase).
- Add file-upload support if Anthropic ever ships it in claude.ai web
  (currently web-only has text + image-paste; API has documents).
- Add council skill provider wrapper at
  `skills/surf-council/providers/claude.cjs` to match the existing pattern
  (chatgpt, gemini, aimode). Note: the council skill directory was not
  present in the working tree at the time of this spec — upstream merge
  may have removed it. This is a separate investigation.
