# Add Claude as a Legacy AI Provider + Delete Unused Architecture

**Date:** 2026-07-07
**Status:** Draft (awaiting user review)
**Author:** Surf brainstorming session (user + Claude)
**Decision record:** Option A — wire legacy, delete dead split-style scaffolding

## Decision Summary

After gathering live evidence via page-agent MCP and re-investigating the
unwired `native/core/` and `native/clients/` architecture, the user selected
**Option A** (rejected Option B, the "split-style first adopter" path, and
rejected Option C, "pause for architecture brainstorm"). Option A is the
smallest change that:

1. Makes `surf claude "PONG"` work end-to-end via the proven legacy pattern.
2. Deletes the half-finished split-style architecture that has been dead code
   since the `27d7f55 feat(sprint): complete AI client architecture sprint`
   commit (2026-04-14) and never had a single caller.
3. Updates Claude's selectors based on live page-agent evidence.

This spec replaces the previous "split-style shim" draft (`853269e`).

## Problem

`surf claude "PONG"` fails with `Error: Unknown tool: claude` (verified in
`.research/ai-smoke-2026-07-07T04-16-46-553Z/report.json`). The dispatch was
added by `d54804f` (2026-03-11) and lost during the upstream merge `909c51d`
which resolved conflicts in favor of upstream — upstream never had Claude.
The legacy `native/claude-client.cjs` survived because it was a new file
with no upstream equivalent.

Compounding this, Claude.ai's live UI has drifted from the selector chain
in `native/claude-client.cjs:SELECTORS`, captured 2026-07-07 via page-agent
MCP against a logged-in Pro plan session:

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

The composer is a contenteditable div; the send affordance requires a real
Enter keypress (no separate button); the legacy `claude-client.cjs:185-202`
already has the Enter dispatch logic — only the selectors need to be
corrected.

Finally, the **split-style architecture is 4-month-old dead code with zero
callers**, which the user has decided to delete rather than resurrect:

- `native/core/client-runtime.cjs` (777 LoC + 469 LoC tests) — exports
  `createClientRuntime()`, never imported outside the runtime itself
- `native/core/completion-engine.cjs` (153 LoC + 158 LoC tests)
- `native/core/signal-normalizer.cjs` (203 LoC, no test file)
- `native/core/cookie-validator.cjs` (392 LoC + 416 LoC tests)
- `native/core/rate-limit-detector.cjs` (161 LoC + 175 LoC tests)
- `native/core/error-detector.cjs` (191 LoC + 244 LoC tests)
- `native/core/strategy-contracts.cjs` (210 LoC, no test file)
- `native/core/ttl-cache.cjs` (124 LoC, no test file)
- `native/clients/{chatgpt,gemini,grok,perplexity,aistudio,aimode}/{config,selectors,strategy}.cjs`
  (7 directories, ~830 LoC, all unwired)
- `native/clients/claude/{config,selectors,strategy}.cjs` (3 files, 225 LoC, unwired)

The total dead-code footprint: **~3000 LoC across 22 files**. All created in
the same sprint (`27d7f55`, 2026-04-14). The migration of any provider to
use the runtime was scoped out of that sprint and never picked up. The
sprint plan file `.research/ai-client-fix-sprint-plan.md` documents the
original 1-9 task list; tasks for actual provider migration were not in
scope.

## Goal

Add Claude as a working AI provider in `surf`, accessible as
`surf claude "..."`, that passes the `npm run test:ai` PONG smoke test.
Use the proven legacy pattern (same as the other 6 providers) and update
selectors based on live UI evidence. Delete the unused split-style
architecture to remove confusion and reduce maintenance surface.

Implementation notes:

- Selector recovery for streaming-state selectors (assistant-message,
  stop-button, thinking-block) when the live UI has not been observed
  streaming. This work will be done as part of the implementation, driven
  by `npm run test:ai` and the `CLAUDE.md` selector-recovery playbook.
  This spec only locks down the composer (idle state) selectors and the
  send path.
- Cookies hardening. The legacy `hasRequiredCookies` accepts `session`,
  `anthropic-device-id`, or `ARID`. Only `sessionKey` is correct for
  claude.ai web. The implementation will narrow this — the spec does not
  pin the exact list, but the smoke test will reveal what works against
  the live page.

Out of scope:

- Migrating any provider to the split-style architecture. The architecture
  itself is being deleted (see "DELETION" section below).
- Council skill, file upload, image attachment, voice mode interaction.
  None are documented requirements. YAGNI.
- Continuous monitoring / scheduling. The PONG smoke test is the
  verification loop.

## Architecture: Wire Legacy `claude-client.cjs` + Delete Dead Code

### The client: `native/claude-client.cjs` (existing, 346 LoC, update selectors)

The legacy client already implements the right pattern. Two changes:

1. **Update `SELECTORS.promptTextarea`** (currently lines 11-12): drop
   the 5 textarea-based selectors that no longer match. Keep:
   ```js
   promptTextarea:
     'div[contenteditable="true"][role="textbox"]',
   ```

2. **Remove `SELECTORS.sendButton`** entirely (currently lines 13-14).
   The send path is Enter-only — `clickSend` at `claude-client.cjs:185-202`
   already dispatches `Input.dispatchKeyEvent` with `key: "Enter"`. The
   send-button selector chain is dead code that confuses readers and adds
   fallback code paths that have no effect.

3. **Streaming-state selectors** (`assistantMessage`, `stopButton`,
   `conversationTurn`): **leave as-is for the first implementation**.
   The smoke test will reveal which branches fire; the `CLAUDE.md`
   selector-recovery playbook handles iteration.

4. **Cookie narrowing** (`claude-client.cjs:50-56`): narrow
   `hasRequiredCookies` to require `sessionKey` (and possibly a
   `lastActiveOrg` or similar). The exact list will be set during
   implementation based on what works against the live page. Acceptable
   to start with the existing list and tighten on first smoke failure.

5. **No change** to the rest of the file: `evaluate`, `waitForPageLoad`,
   `checkLoginStatus`, `waitForPromptReady`, `typePrompt`, `clickSend`,
   `waitForResponse`, `getAssistantContent`, `query` all stay. The CDP
   logic is correct; only selectors and cookies are wrong.

### The host: `native/host.cjs`

Add the require and the dispatch, mirroring the existing chatgpt pattern
(`host.cjs:482-545`) but adapted for Claude (no file upload):

1. **Require** the client:
   ```js
   const claudeClient = require("./claude-client.cjs");
   ```

2. **Add `case "CLAUDE_QUERY"`** to `handleToolRequest`, ~80 lines:
   - `getCookies` → `GET_CLAUDE_COOKIES` message
   - `createTab` → `CLAUDE_NEW_TAB` message (URL: `https://claude.ai/`)
   - `closeTab` → `CLAUDE_CLOSE_TAB` message
   - `cdpEvaluate` → `CLAUDE_EVALUATE` message
   - `cdpCommand` → `CLAUDE_CDP_COMMAND` message
   - All messages routed through `pendingToolRequests` / `writeMessage`
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
  This is the only non-trivial deviation — chatgpt's `GET_CHATGPT_COOKIES`
  is handler-specific; Claude needs the same pattern but for the claude.ai
  domain. Implementation mirrors the chatgpt handler.

Also add the 5 message types to the `allowedMessages` /
message-allow-list at `service-worker/index.ts:3582-3588`.

### The legacy client: keep (do not delete)

After the dispatch is wired, `native/claude-client.cjs` is the **only**
Claude implementation. Do not delete. The split-style `native/clients/claude/*`
files ARE deleted (see below), but the legacy client is the production path.

### DELETION: split-style architecture (the cleanup half of this spec)

**This is a destructive change.** It must be approved by the user before
execution. The full deletion list:

| Path | Action | Reason |
|---|---|---|
| `native/core/client-runtime.cjs` | delete | zero callers, dead since 2026-04-14 |
| `native/core/client-runtime.test.cjs` | delete | same |
| `native/core/completion-engine.cjs` | delete | zero callers |
| `native/core/completion-engine.test.cjs` | delete | same |
| `native/core/signal-normalizer.cjs` | delete | zero callers, no test file |
| `native/core/cookie-validator.cjs` | delete | zero callers |
| `native/core/cookie-validator.test.cjs` | delete | same |
| `native/core/rate-limit-detector.cjs` | delete | zero callers |
| `native/core/rate-limit-detector.test.cjs` | delete | same |
| `native/core/error-detector.cjs` | delete | zero callers |
| `native/core/error-detector.test.cjs` | delete | same |
| `native/core/strategy-contracts.cjs` | delete | zero callers, no test file |
| `native/core/ttl-cache.cjs` | delete | zero callers, no test file |
| `native/clients/` (entire directory) | delete | all 7 subdirectories unwired |
| `biome.json` `files.includes` entries for `native/core/` and `native/clients/` | remove | no longer relevant |
| `vitest.config.ts` `include` entries for `native/core/*` test files | remove | no longer relevant |
| `package.json` test script if it references these paths | adjust | no longer relevant |

The deletion is **fully reversible via git** (`git revert`). The risk is
not data loss but discovery: future readers may wonder "where did the
split-style architecture go?" The deletion commit message will document
this and reference this spec.

**Special case: `.research/ai-client-fix-sprint-plan.md`** — the sprint
plan file (249 LoC, added in `27d7f55`). This documents the original
intent of the architecture. **Keep it** as historical reference; it
explains *why* the architecture existed even after it's deleted.

**Total deletion footprint:** ~3000 LoC across ~22 files plus config
updates in 3 build files.

## Data Flow

End-to-end trace for `surf claude "PONG"`:

```
CLI (cli.cjs)
  ↓ writes JSON to /tmp/surf.sock
Native Host (host.cjs → handleToolRequest)
  ↓ recognizes "claude" tool
  ↓ calls claudeClient.query({ prompt, getCookies, createTab, ... })
Client (claude-client.cjs)
  ↓ hasRequiredCookies(cookies) → OK
  ↓ createTab() → CLAUDE_NEW_TAB → service-worker → returns tabId
  ↓ waitForPageLoad(cdp) → page ready
  ↓ checkLoginStatus(cdp) → logged in
  ↓ waitForPromptReady(cdp) → composer visible
  ↓ typePrompt(cdp, inputCdp, prompt) → text in contenteditable
  ↓ clickSend(cdp, inputCdp) → Enter key dispatched
  ↓ waitForResponse(cdp, timeout) → polls content until stable
    ↓ evaluates SELECTORS.stopButton, SELECTORS.assistantMessage
    ↓ returns when content stable + stop button gone
  ↓ closeTab() → CLAUDE_CLOSE_TAB
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
| Click send does not submit (Enter ignored) | `error` | page-state check (composer still has text) |
| Response never completes | `complete-timeout` | `waitForResponse` timeout |
| Response selector misses content | `selector` | `response.text === ""` after timeout |
| Claude rate-limits the user | `rate-limit` | rate-limit text patterns in pageContent |
| Claude returns a server error | `error` | error text patterns in pageContent |
| CDP/extension disconnect | `error` | `cdpEvaluate` / `cdpCommand` throws |

The smoke test (`native/tests/ai-provider-smoke.cjs`) already classifies
these — see `2026-06-12-ai-provider-stability-test-design.md` for the
classification contract. No new failure modes are introduced.

## Testing Strategy

### Unit tests (in `test/unit/claude-client.test.ts`)

Cover the changes in `claude-client.cjs`:

- `hasRequiredCookies` accepts a claude.ai session cookie.
- `hasRequiredCookies` rejects when only Anthropic API cookies are present.
- `query()` rejects with "Claude.ai login required" if no valid cookies.
- `query()` rejects with "Failed to create Claude.ai tab" if createTab fails.
- `query()` calls `closeTab` in `finally`, even on error.
- The exported `SELECTORS.promptTextarea` matches the contenteditable div
  selector (assert exact string).

These are **small, focused tests** for the changes. The legacy CDP logic
(typing, send, wait) is not unit-tested today and adding tests for it is
out of scope.

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
the diagnostic loop is the existing `CLAUDE.md` selector-recovery playbook,
with page-agent MCP as the browser-driving surface. The implementation
does not change the recovery loop — it only makes the initial wiring
land on the right baseline (composer contenteditable, send via Enter).

## Risks

1. **Streaming-state selector drift.** Page-agent could not capture
   streaming DOM (no Enter dispatch in the MCP toolset). The first smoke
   test run will reveal whether the current `assistant-message` /
   `stop-button` / `thinking-block` selectors in
   `native/claude-client.cjs:15-19` still match. If they don't, the
   `CLAUDE.md` selector-recovery playbook applies.

2. **Cookies hardening.** The legacy `hasRequiredCookies` accepts cookies
   that don't apply to claude.ai web (`anthropic-device-id`, `ARID`). The
   implementation will narrow this to claude.ai session cookies. If too
   narrow, smoke test fails with `login-required` and we widen; if too
   broad, we accept false positives and tighten.

3. **Service-worker message types are added but unverified in a
   logged-in Chrome session.** The implementation can compile and lint
   clean without a live browser. The smoke test is the only real
   validation. If the user can't run `npm run test:ai` interactively,
   the implementation may ship broken.

4. **Mass deletion risk.** The split-style architecture (~3000 LoC across
   ~22 files) is being deleted in one commit. If a hidden caller exists
   (not detected by grep — e.g., dynamic require, build-time codegen),
   deletion will break the build. Mitigation: run `npm run check`,
   `npm run lint`, `npm run test` before committing; `npm run build` to
   verify the build output. Reversible via git if anything breaks.

5. **The deletion removes tests, not just code.** `client-runtime.test.cjs`
   (469 LoC), `cookie-validator.test.cjs` (416 LoC), and others were
   test suites that had no production caller. Deleting them removes
   future maintenance surface but also removes "free" regression
   coverage. Acceptable per the user's Option A decision.

6. **Page-agent MCP can't drive Enter or evaluate JS in this environment.**
   The implementation will compile and the smoke test will run, but the
   user (not the AI agent) is the one driving the live browser during
   selector recovery. That's a real friction, not a blocker.

## Success Criteria

The implementation is complete when:

- [ ] `native/claude-client.cjs:SELECTORS.promptTextarea` is updated to
      `div[contenteditable="true"][role="textbox"]` (verified via
      page-agent on a logged-in Pro plan session).
- [ ] `native/claude-client.cjs:SELECTORS.sendButton` is removed.
- [ ] `native/host.cjs` requires `./claude-client.cjs` and handles
      `CLAUDE_QUERY`.
- [ ] `native/host-helpers.cjs:mapToolToMessage` has a `case "claude"`.
- [ ] `native/cli.cjs` has a `claude` block in `TOOLS` help, an entry
      in `PRIMARY_ARG_MAP`, and an entry in `AI_TOOLS`.
- [ ] `src/service-worker/index.ts` has 5 new message handlers
      (`CLAUDE_NEW_TAB`, `CLAUDE_CLOSE_TAB`, `CLAUDE_CDP_COMMAND`,
      `CLAUDE_EVALUATE`, `GET_CLAUDE_COOKIES`) and they are in the
      allowed-messages list.
- [ ] `npm run build` produces a working dist/.
- [ ] `npm run check` and `npm run lint` pass clean.
- [ ] `npm run test -- test/unit/claude-client.test.ts` passes the new
      unit tests.
- [ ] `npm run test:ai` runs the Claude case and either returns
      "PONG" or fails with `failureKind: login-required` or
      `failureKind: selector` (acceptable, surfaces recovery loop).
- [ ] `surf claude --help` shows the same help shape as
      `surf chatgpt --help`.
- [ ] `native/core/` and `native/clients/` are deleted.
- [ ] `biome.json`, `vitest.config.ts`, and `package.json` are updated
      to remove references to deleted paths.
- [ ] `.research/ai-client-fix-sprint-plan.md` is kept (historical
      reference, explains why the split-style existed).
- [ ] Other 6 providers do not regress (chatgpt, gemini, perplexity,
      grok, aistudio, aimode smoke tests still PASS or fail with the
      same kind as before).

## Open Questions

None for this spec. The cookie list, streaming-state selectors, and any
remaining gaps will be resolved during implementation via the smoke test
+ selector-recovery loop.

## Follow-up Work (deferred, not in scope)

- Selector recovery for streaming-state selectors (assistant-message,
  stop-button, thinking-block) after the first smoke test reveals what
  the live UI exposes.
- Cookie narrowing — the exact list of claude.ai session cookies that
  indicates a valid login. Implementation will iterate based on smoke
  test results.
- Add file-upload support if Anthropic ever ships it in claude.ai web
  (currently web-only has text + image-paste; API has documents).
- Add a council skill provider wrapper at
  `skills/surf-council/providers/claude.cjs` if/when the council skill
  is restored. Note: the council skill directory was not present in the
  working tree at the time of this spec — upstream merge may have
  removed it. This is a separate investigation.
