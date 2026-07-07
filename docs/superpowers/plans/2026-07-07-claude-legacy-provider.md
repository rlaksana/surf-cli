# Claude Legacy Provider + Delete Dead Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `native/claude-client.cjs` (existing 346 LoC) as a working `surf claude` AI provider using the chatgpt dispatch pattern, fix the live UI selectors based on page-agent MCP evidence, and delete the unused split-style architecture (`native/core/` + `native/clients/`, ~3000 LoC across ~22 files).

**Architecture:** Mirror the proven chatgpt pattern — service worker opens Claude.ai in a background tab, host.cjs routes `CLAUDE_QUERY` through helper closures, `claude-client.cjs` uses CDP to type into the contenteditable composer and dispatch an Enter key. The selectors are updated for the live UI (composer is a contenteditable div, not a textarea). The 4-month-old split-style architecture (`native/core/`, `native/clients/`) has zero callers and is deleted.

**Tech Stack:** Node.js / CommonJS (host, host-helpers, cli, claude-client); TypeScript / Chrome Extension Manifest V3 (service worker); Vitest (unit tests); Biome (lint); Vite (build).

## Global Constraints

- **Platform:** Windows 11 (path separators must use `\\` in PowerShell, `/` in Git Bash). Spec verified at `E:\surf-cli`.
- **Browser target:** Claude.ai in Edge or Chrome with the surf extension loaded; cookies for `claude.ai` indicate logged-in state.
- **Build pipeline:** Vite compiles `src/service-worker/index.ts` and other extension sources to `dist/`. Run `npm run build` after service-worker changes; run `npm run install:native -- --id <extension-id>` to install the native host with the extension ID.
- **Acceptance test:** `npm run test:ai` runs `native/tests/ai-provider-smoke.cjs`, which iterates 7 providers (chatgpt, gemini, perplexity, grok, aistudio, aistudio.build, aimode) and now claude. Each provider gets the prompt `"Reply with the single word PONG and nothing else"` with 90s timeout.
- **Lint rules:** Biome (`biome.json`) flags `noVoid` (never use `void expr`), `noNestedPromises` (no `.then()` inside `.then()`), and `noExcessiveCognitiveComplexity` (warning only). Empty `catch {}` blocks require a comment.
- **Line endings:** LF only; CRLF→LF warnings on Windows are harmless normalization noise.
- **Reversibility:** Every commit is `git revert`-able. The mass deletion (Task 13) is the riskiest step and is gated by the build/lint/test verification in Task 14.

## File Structure

This plan modifies these files:

| Path | Action | Responsibility |
|---|---|---|
| `native/claude-client.cjs` | modify (selectors + cookies) | Existing legacy CDP client; needs selector update + cookie narrowing |
| `native/host.cjs` | modify (require + dispatch) | Native host; add Claude require + `CLAUDE_QUERY` handler |
| `native/host-helpers.cjs` | modify (case "claude") | Message router; add `case "claude"` returning `CLAUDE_QUERY` |
| `native/cli.cjs` | modify (3 additions) | CLI front-end; add `claude` help entry, `PRIMARY_ARG_MAP`, `AI_TOOLS` |
| `src/service-worker/index.ts` | modify (5 cases + allow-list) | Service worker; add Claude tab/eval/command/cookie handlers |
| `test/unit/claude-client.test.ts` | create | New Vitest unit tests for the changes |
| `biome.json` | modify (remove 2 includes) | Remove `native/core/` and `native/clients/` from lint includes |

This plan deletes these files (Task 13):

| Path | Reason |
|---|---|
| `native/core/` (entire dir, 8 modules + 5 tests) | Zero callers since 2026-04-14 |
| `native/clients/` (entire dir, 7 subdirs) | All client subdirs unwired |

This plan does **not** touch:

- `.research/ai-client-fix-sprint-plan.md` — kept as historical reference
- `native/chatgpt-client.cjs` and the other 5 legacy `<name>-client.cjs` files — they remain unchanged
- `dist/` — output of `npm run build`; rebuild after service worker changes

---

## Task 1: Update Claude Selectors + Cookies

**Files:**
- Modify: `native/claude-client.cjs:10-19` (SELECTORS) and `native/claude-client.cjs:44-56` (cookie matcher)
- Test: `test/unit/claude-client.test.ts` (new file, written in Task 2)

**Context:** Page-agent MCP verified on 2026-07-07 against a logged-in Pro plan session:
- Composer is `div[contenteditable="true"][role="textbox"]` (aria-label "Write your prompt to Claude"). The textarea-based selectors do not match.
- There is no `Send message` button. The rightmost composer toolbar icon activates voice dictation when clicked. The send path is Enter key (already correctly dispatched in `claude-client.cjs:185-202`).

The changes:
1. Replace the textarea chain in `SELECTORS.promptTextarea` (lines 11-12) with the single contenteditable div selector.
2. Remove `SELECTORS.sendButton` (lines 13-14) entirely. The `clickSend` function uses Enter dispatch and ignores the send-button selector in practice.
3. Keep `SELECTORS.assistantMessage`, `SELECTORS.stopButton`, `SELECTORS.conversationTurn` unchanged for this task — they will be tested by the smoke test in Task 12, and any drift will be addressed via the `CLAUDE.md` selector-recovery playbook.
4. Narrow `hasRequiredCookies` to require a `sessionKey` cookie OR any cookie whose name starts with `session` (matches both `sessionKey` and `session-key` variations). Drop `anthropic-device-id` and `ARID` (those are Anthropic API cookies, not claude.ai web).

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `SELECTORS.promptTextarea` (single string), `SELECTORS.sendButton` (removed); `hasRequiredCookies(cookies)` returns true only for claude.ai session cookies.

- [ ] **Step 1: Open `native/claude-client.cjs` and replace the SELECTORS object (lines 10-19)**

The new SELECTORS object:

```js
const SELECTORS = {
  promptTextarea:
    'div[contenteditable="true"][role="textbox"]',
  assistantMessage:
    '[data-is-streaming="false"], .font-claude-response, [data-turn-author="assistant"], [data-testid="assistant-message"]',
  stopButton: '[data-testid="stop-button"], button[aria-label="Stop"], button[aria-label="Stop generating"]',
  conversationTurn:
    '[data-is-streaming="false"], .font-claude-response, [data-turn-author="assistant"], [data-testid="assistant-message"], .claude-message',
};
```

Note: `sendButton` is removed; `clickSend` already dispatches Enter at lines 185-202 regardless.

Replace exactly lines 10-19 with the block above. Do not modify lines outside this range.

- [ ] **Step 2: Replace `hasRequiredCookies` (lines 44-56)**

Old (lines 44-56):

```js
function hasRequiredCookies(cookies) {
  if (!cookies || !Array.isArray(cookies)) {
    return false;
  }
  // Check for session-related cookies (sessionKey, any session cookie)
  // or device ID cookies that indicate authenticated session
  const validCookie = cookies.find(
    (c) =>
      c.value &&
      (c.name.includes("session") || c.name === "anthropic-device-id" || c.name === "ARID"),
  );
  return Boolean(validCookie);
}
```

New:

```js
function hasRequiredCookies(cookies) {
  if (!cookies || !Array.isArray(cookies)) {
    return false;
  }
  // Claude.ai web uses session cookies for auth. Anthropic API cookies
  // (anthropic-device-id, ARID) are NOT valid here — those authenticate
  // the API at console.anthropic.com / api.anthropic.com, not claude.ai.
  // Accept sessionKey and any session-prefixed cookie (covers session-key
  // and future variations).
  const validCookie = cookies.find(
    (c) => c.value && (c.name === "sessionKey" || c.name.startsWith("session"))
  );
  return Boolean(validCookie);
}
```

Replace exactly lines 44-56 with the block above.

- [ ] **Step 3: Verify the changes look right**

Run:

```bash
cd E:/surf-cli
sed -n '8,20p' native/claude-client.cjs
sed -n '44,58p' native/claude-client.cjs
```

Expected:
- `SELECTORS.promptTextarea` is the single contenteditable div selector
- `SELECTORS.sendButton` is gone
- `hasRequiredCookies` only matches `sessionKey` or `session*`

- [ ] **Step 4: Run `npm run check`**

Run:

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -20
```

Expected: zero TypeScript errors. (The .cjs file is not in tsconfig, but the check still validates the rest of the repo.)

If errors: fix and rerun.

- [ ] **Step 5: Commit**

```bash
cd E:/surf-cli && git add native/claude-client.cjs && git commit -m "fix(claude): update selectors for contenteditable composer

Page-agent MCP capture 2026-07-07 on a logged-in Pro plan session:
- The Claude.ai composer is a contenteditable div (role=textbox,
  aria-label='Write your prompt to Claude'), not a textarea.
- There is no separate send button. The send path is Enter key,
  which clickSend already dispatches via Input.dispatchKeyEvent.

Changes:
- SELECTORS.promptTextarea: replace 5 textarea-based branches with
  the single contenteditable div selector.
- SELECTORS.sendButton: removed. The click path did nothing
  useful (the rightmost toolbar icon activates voice dictation).
- hasRequiredCookies: drop anthropic-device-id / ARID (Anthropic
  API cookies, not claude.ai web). Require sessionKey or any
  session*-prefixed cookie.

Streaming-state selectors (assistantMessage, stopButton,
conversationTurn) are unchanged for this task. The smoke test
in Task 12 will reveal what the live UI exposes; recovery
follows the documented 4-snapshot selector-recovery playbook.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Write Unit Tests for Selectors + Cookies

**Files:**
- Create: `test/unit/claude-client.test.ts`

**Context:** The existing `test/unit/chatgpt-client.test.ts` (501 lines) is the reference for CJS module mocking in Vitest. Claude-client uses CommonJS so we follow the same pattern.

**Interfaces:**
- Consumes: `native/claude-client.cjs` (`query`, `hasRequiredCookies`, `SELECTORS`, `CLAUDE_URL`)
- Produces: a Vitest test file that runs `npm run test -- test/unit/claude-client.test.ts` to green.

- [ ] **Step 1: Look at the chatgpt test mocking pattern**

Run:

```bash
cd E:/surf-cli && sed -n '1,40p' test/unit/chatgpt-client.test.ts
```

Read enough to understand: how does it import the CJS module? How does it mock closures like `createTab`?

- [ ] **Step 2: Create `test/unit/claude-client.test.ts`**

Write the following file at `E:/surf-cli/test/unit/claude-client.test.ts`. The tests cover only the changes from Task 1 (selectors + cookies) and the smoke-test-essential paths (login rejection, tab creation failure, closeTab in finally). They do NOT re-test every legacy CDP helper.

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// CommonJS import via require pattern used in test/unit/chatgpt-client.test.ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const claudeClient = require("../../native/claude-client.cjs");
const { query, hasRequiredCookies, SELECTORS, CLAUDE_URL } = claudeClient;

describe("claude-client SELECTORS", () => {
  it("promptTextarea targets the contenteditable div", () => {
    expect(SELECTORS.promptTextarea).toBe(
      'div[contenteditable="true"][role="textbox"]'
    );
  });

  it("sendButton is removed (Enter-only send path)", () => {
    expect(SELECTORS).not.toHaveProperty("sendButton");
  });

  it("exports CLAUDE_URL pointing at claude.ai", () => {
    expect(CLAUDE_URL).toBe("https://claude.ai/");
  });
});

describe("claude-client hasRequiredCookies", () => {
  it("accepts a sessionKey cookie", () => {
    expect(
      hasRequiredCookies([{ name: "sessionKey", value: "abc123" }])
    ).toBe(true);
  });

  it("accepts cookies whose name starts with session", () => {
    expect(
      hasRequiredCookies([{ name: "session-key", value: "xyz789" }])
    ).toBe(true);
    expect(
      hasRequiredCookies([{ name: "sessionFoo", value: "f" }])
    ).toBe(true);
  });

  it("rejects Anthropic API cookies (anthropic-device-id, ARID)", () => {
    expect(
      hasRequiredCookies([{ name: "anthropic-device-id", value: "x" }])
    ).toBe(false);
    expect(
      hasRequiredCookies([{ name: "ARID", value: "y" }])
    ).toBe(false);
  });

  it("rejects when cookies is null or empty", () => {
    expect(hasRequiredCookies(null)).toBe(false);
    expect(hasRequiredCookies([])).toBe(false);
    expect(hasRequiredCookies(undefined)).toBe(false);
  });

  it("rejects cookies with empty values", () => {
    expect(hasRequiredCookies([{ name: "sessionKey", value: "" }])).toBe(
      false
    );
  });
});

describe("claude-client query() error paths", () => {
  it("rejects with login-required error when cookies are missing", async () => {
    const getCookies = async () => ({ cookies: [] });
    const createTab = vi.fn();
    const closeTab = vi.fn();
    const cdpEvaluate = vi.fn();
    const cdpCommand = vi.fn();
    const log = vi.fn();

    await expect(
      query({
        prompt: "hi",
        getCookies,
        createTab,
        closeTab,
        cdpEvaluate,
        cdpCommand,
        log,
      })
    ).rejects.toThrow(/login required/i);

    // Login fail should never create a tab
    expect(createTab).not.toHaveBeenCalled();
  });

  it("rejects when createTab fails to return a tabId", async () => {
    const getCookies = async () => ({
      cookies: [{ name: "sessionKey", value: "abc" }],
    });
    const createTab = vi.fn(async () => ({})); // no tabId
    const closeTab = vi.fn();
    const cdpEvaluate = vi.fn();
    const cdpCommand = vi.fn();
    const log = vi.fn();

    await expect(
      query({
        prompt: "hi",
        getCookies,
        createTab,
        closeTab,
        cdpEvaluate,
        cdpCommand,
        log,
      })
    ).rejects.toThrow(/Failed to create Claude\.ai tab/i);

    expect(createTab).toHaveBeenCalledTimes(1);
    // No tab to close, so closeTab should not be called
    expect(closeTab).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests, expect them to pass**

```bash
cd E:/surf-cli && npm run test -- test/unit/claude-client.test.ts 2>&1 | tail -40
```

Expected: all 9 tests pass. If any fail, fix the test or the implementation (in `claude-client.cjs`) and rerun.

- [ ] **Step 4: Commit**

```bash
cd E:/surf-cli && git add test/unit/claude-client.test.ts && git commit -m "test(claude): add unit tests for selectors, cookies, error paths

Covers the Task 1 changes:
- SELECTORS.promptTextarea is the contenteditable div selector
- SELECTORS.sendButton is removed
- hasRequiredCookies accepts sessionKey / session* cookies only
- query() rejects with login-required when cookies missing
- query() rejects when createTab fails to return tabId

The legacy CDP logic (typing, send, wait) is not unit-tested here;
the smoke test in Task 12 covers end-to-end behavior.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add `GET_CLAUDE_COOKIES` Handler to Service Worker

**Files:**
- Modify: `src/service-worker/index.ts:3093-3097` (insert new case after `GET_CHATGPT_COOKIES`)

**Context:** The service worker already has `GET_CHATGPT_COOKIES` at line 3093. Claude's variant queries `.claude.ai` cookies. Per the user's note in this spec, multiple `.claude.ai` subdomains exist (claude.ai, claude.com for proxied assets) — for now, query just `.claude.ai`; the implementation can be widened if smoke test fails.

**Interfaces:**
- Consumes: `chrome.cookies.getAll({ domain: ".claude.ai" })`
- Produces: returns `{ cookies: [...] }` exactly matching chatgpt's response shape.

- [ ] **Step 1: Read the chatgpt cookie handler to mirror it**

Run:

```bash
cd E:/surf-cli && sed -n '3093,3097p' src/service-worker/index.ts
```

Expected output:

```ts
    case "GET_CHATGPT_COOKIES": {
      const cookies = await chrome.cookies.getAll({ domain: ".chatgpt.com" });
      const openaiCookies = await chrome.cookies.getAll({ domain: ".openai.com" });
      return { cookies: [...cookies, ...openaiCookies] };
    }
```

- [ ] **Step 2: Add `GET_CLAUDE_COOKIES` case directly after `GET_CHATGPT_COOKIES`**

After the line `return { cookies: [...cookies, ...openaiCookies] };` (line 3096), insert a blank line then:

```ts

    case "GET_CLAUDE_COOKIES": {
      const cookies = await chrome.cookies.getAll({ domain: ".claude.ai" });
      return { cookies };
    }
```

The full insertion (lines to find and edit):

```ts
    case "GET_CHATGPT_COOKIES": {
      const cookies = await chrome.cookies.getAll({ domain: ".chatgpt.com" });
      const openaiCookies = await chrome.cookies.getAll({ domain: ".openai.com" });
      return { cookies: [...cookies, ...openaiCookies] };
    }

    case "GET_CLAUDE_COOKIES": {
      const cookies = await chrome.cookies.getAll({ domain: ".claude.ai" });
      return { cookies };
    }
```

- [ ] **Step 3: Run `npm run check`**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -20
```

Expected: passes. If any TS error appears in the new case block, fix it.

- [ ] **Step 4: Commit**

```bash
cd E:/surf-cli && git add src/service-worker/index.ts && git commit -m "feat(sw): add GET_CLAUDE_COOKIES handler

Mirror GET_CHATGPT_COOKIES (line 3093) but query cookies for
.claude.ai instead of .chatgpt.com / .openai.com.

The returned shape matches chatgpt exactly ({ cookies: [...] })
so host.cjs can use identical routing code.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Add `CLAUDE_NEW_TAB` Handler to Service Worker

**Files:**
- Modify: `src/service-worker/index.ts` (insert after `CHATGPT_NEW_TAB` at line 3125)

**Context:** Mirror CHATGPT_NEW_TAB (lines 3099-3125). Open `https://claude.ai/` in background (`active: false` per `f8a0250 fix(service-worker): open AI provider tabs in background, do not steal focus`). Wait for `status === "complete"`, attach CDP, wait for runtime ready.

The first CDP attach to a new tab takes ~100-500ms (per `CLAUDE.md` "Important Implementation Details"). The 30s wait timeout and 10s `waitForRuntimeReady` come from the chatgpt handler verbatim.

**Interfaces:**
- Consumes: `chrome.tabs.create`, `cdp.attach`, `waitForRuntimeReady` (already imported)
- Produces: returns `{ tabId: number }` matching chatgpt's response shape.

- [ ] **Step 1: Read the chatgpt tab handler to mirror it**

Run:

```bash
cd E:/surf-cli && sed -n '3099,3125p' src/service-worker/index.ts
```

Expected: the full `CHATGPT_NEW_TAB` block.

- [ ] **Step 2: Add `CLAUDE_NEW_TAB` case directly after `CHATGPT_NEW_TAB`**

After the line `return { tabId: tab.id };` (line 3124) — this is the last line of CHATGPT_NEW_TAB — insert a blank line then:

```ts

    case "CLAUDE_NEW_TAB": {
      const tab = await chrome.tabs.create({
        url: "https://claude.ai/",
        active: false,
      });
      if (!tab.id) throw new Error("Failed to create tab");
      const currentTab = await chrome.tabs.get(tab.id);
      if (currentTab.status !== "complete") {
        await new Promise<void>((resolve) => {
          const listener = (tabId: number, info: chrome.tabs.OnUpdatedInfo) => {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 30000);
        });
      }
      await cdp.attach(tab.id);
      await waitForRuntimeReady(tab.id, 10000);
      return { tabId: tab.id };
    }
```

The insertion matches CHATGPT_NEW_TAB byte-for-byte except for the message name (`CLAUDE_NEW_TAB`) and URL (`https://claude.ai/`).

- [ ] **Step 3: Run `npm run check`**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -20
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
cd E:/surf-cli && git add src/service-worker/index.ts && git commit -m "feat(sw): add CLAUDE_NEW_TAB handler

Mirror CHATGPT_NEW_TAB (line 3099). Opens https://claude.ai/ in
a background tab (active: false per f8a0250 fix-service-worker
background open), waits for page load, attaches CDP, and waits
for JS runtime readiness before returning { tabId }.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Add `CLAUDE_CLOSE_TAB` Handler to Service Worker

**Files:**
- Modify: `src/service-worker/index.ts` (insert after `CLAUDE_NEW_TAB` or after `CHATGPT_CLOSE_TAB`)

- [ ] **Step 1: Read the chatgpt close handler**

Run:

```bash
cd E:/surf-cli && sed -n '3127,3138p' src/service-worker/index.ts
```

Expected output:

```ts
    case "CHATGPT_CLOSE_TAB": {
      const chatTabId = message.tabId;
      if (chatTabId) {
        try {
          await cdp.detach(chatTabId);
        } catch {}
        try {
          await chrome.tabs.remove(chatTabId);
        } catch {}
      }
      return { success: true };
    }
```

- [ ] **Step 2: Add `CLAUDE_CLOSE_TAB` case directly after `CHATGPT_CLOSE_TAB`**

After the line `return { success: true };` (line 3137), insert a blank line then:

```ts

    case "CLAUDE_CLOSE_TAB": {
      const claudeTabId = message.tabId;
      if (claudeTabId) {
        try {
          await cdp.detach(claudeTabId);
        } catch {}
        try {
          await chrome.tabs.remove(claudeTabId);
        } catch {}
      }
      return { success: true };
    }
```

The handler is byte-identical to CHATGPT_CLOSE_TAB except `chatTabId` is renamed to `claudeTabId` for grep-ability.

- [ ] **Step 3: Run `npm run check`**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -10
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
cd E:/surf-cli && git add src/service-worker/index.ts && git commit -m "feat(sw): add CLAUDE_CLOSE_TAB handler

Mirror CHATGPT_CLOSE_TAB (line 3127). Detaches CDP and removes
the Claude.ai background tab. Same try/catch pattern - tab may
already be closed.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Add `CLAUDE_CDP_COMMAND` and `CLAUDE_EVALUATE` Handlers

**Files:**
- Modify: `src/service-worker/index.ts` (insert after the close-tab cases, before the perplexity case at line 3151)

**Context:** These are 2-line message pass-throughs to `cdp.sendCommand` and `cdp.evaluateScript`. Trivial.

- [ ] **Step 1: Read the chatgpt CDP command + evaluate handlers**

Run:

```bash
cd E:/surf-cli && sed -n '3140,3149p' src/service-worker/index.ts
```

Expected output:

```ts
    case "CHATGPT_CDP_COMMAND": {
      const { method, params } = message;
      const result = await cdp.sendCommand(message.tabId, method, params || {});
      return result;
    }

    case "CHATGPT_EVALUATE": {
      const result = await cdp.evaluateScript(message.tabId, message.expression);
      return result;
    }
```

- [ ] **Step 2: Add `CLAUDE_CDP_COMMAND` and `CLAUDE_EVALUATE` cases directly after `CHATGPT_EVALUATE`**

After the line `return result;` (line 3148) — the last line of CHATGPT_EVALUATE — insert a blank line then:

```ts

    case "CLAUDE_CDP_COMMAND": {
      const { method, params } = message;
      const result = await cdp.sendCommand(message.tabId, method, params || {});
      return result;
    }

    case "CLAUDE_EVALUATE": {
      const result = await cdp.evaluateScript(message.tabId, message.expression);
      return result;
    }
```

These are byte-identical to the chatgpt variants except for the message names.

- [ ] **Step 3: Run `npm run check`**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -10
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
cd E:/surf-cli && git add src/service-worker/index.ts && git commit -m "feat(sw): add CLAUDE_CDP_COMMAND and CLAUDE_EVALUATE handlers

Mirror CHATGPT_CDP_COMMAND (line 3140) and CHATGPT_EVALUATE (line 3146).
Both pass through to cdp.sendCommand / cdp.evaluateScript respectively,
allowing claude-client.cjs to drive the Claude.ai CDP tabs as it types
prompts and dispatches key events.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Add Claude Message Types to the Service Worker Allow-List

**Files:**
- Modify: `src/service-worker/index.ts:3582-3588` (find the `allowedMessages` array containing `CHATGPT_NEW_TAB`, `CHATGPT_CLOSE_TAB`, `CHATGPT_EVALUATE`, `CHATGPT_CDP_COMMAND`, `GET_CHATGPT_COOKIES`)

**Context:** Chrome's extension messaging requires message types to be in an allow-list (whitelist). Without this, the new `CLAUDE_*` and `GET_CLAUDE_COOKIES` messages will be rejected by Chrome's `chrome.runtime.onMessage` listener even if a handler exists.

**Interfaces:**
- Consumes: existing allow-list array
- Produces: 5 new strings in the allow-list (`CLAUDE_NEW_TAB`, `CLAUDE_CLOSE_TAB`, `CLAUDE_EVALUATE`, `CLAUDE_CDP_COMMAND`, `GET_CLAUDE_COOKIES`).

- [ ] **Step 1: Read the allow-list**

Run:

```bash
cd E:/surf-cli && sed -n '3575,3595p' src/service-worker/index.ts
```

Look for the array literal containing the chatgpt message type strings.

- [ ] **Step 2: Add the 5 Claude message types to the allow-list**

Find the line that contains:

```ts
  "CHATGPT_NEW_TAB", "CHATGPT_CLOSE_TAB", "CHATGPT_EVALUATE", "CHATGPT_CDP_COMMAND",
```

(or equivalent). Directly after that line, add:

```ts
  "CLAUDE_NEW_TAB", "CLAUDE_CLOSE_TAB", "CLAUDE_EVALUATE", "CLAUDE_CDP_COMMAND", "GET_CLAUDE_COOKIES",
```

If the allow-list groups the chatgpt cookie getter on a separate line (`"GET_CHATGPT_COOKIES"` appears elsewhere), also find that line and add `"GET_CLAUDE_COOKIES"` next to it. The exact placement depends on how the array was authored — keep the additions adjacent to the chatgpt equivalents.

- [ ] **Step 3: Run `npm run check`**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -10
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
cd E:/surf-cli && git add src/service-worker/index.ts && git commit -m "feat(sw): add Claude message types to allow-list

Chrome extension messaging requires message types to be whitelisted
in the runtime.onMessage listener. Without these 5 entries, the
CLAUDE_* cases added in Tasks 3-6 will be rejected by Chrome even
though the handler exists.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Add `case "claude"` to `mapToolToMessage` in `host-helpers.cjs`

**Files:**
- Modify: `native/host-helpers.cjs:1068-1078` (insert `case "claude"` after the `chatgpt` case)

- [ ] **Step 1: Read the chatgpt case to mirror it**

Run:

```bash
cd E:/surf-cli && sed -n '1068,1080p' native/host-helpers.cjs
```

Expected output:

```js
    case "chatgpt":
      if (!a.query) throw new Error("query required");
      return { 
        type: "CHATGPT_QUERY", 
        query: a.query, 
        model: a.model,
        withPage: a["with-page"],
        file: a.file,
        timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 2700000,
        ...baseMsg 
      };
```

- [ ] **Step 2: Add `case "claude"` directly after the `chatgpt` case**

Find the closing `};` of the chatgpt case at line 1078 and insert a blank line then:

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

Differences from chatgpt:
- Message type is `CLAUDE_QUERY` (not `CHATGPT_QUERY`).
- No `file` field (Claude provider has no file upload in this iteration).
- Default timeout is 300000ms (5 min) vs chatgpt's 2700000ms (45 min). Matches the value used in legacy `claude-client.cjs:303` (`timeout = 300000`).

- [ ] **Step 3: Run `npm run check`**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -10
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
cd E:/surf-cli && git add native/host-helpers.cjs && git commit -m "feat(host-helpers): route claude tool to CLAUDE_QUERY

Mirror the chatgpt case (line 1068) but:
- Use the CLAUDE_QUERY message type matching the service-worker
  handler added in Tasks 3-4.
- Default timeout 5 min (300000 ms), matching
  claude-client.cjs:303 default.
- Omit the file field; claude.ai web has no file upload in this
  iteration.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Add `CLAUDE_QUERY` Dispatch to `host.cjs`

**Files:**
- Modify: `native/host.cjs:9-15` (add require) and add `case "CLAUDE_QUERY":` block after the existing chatgpt dispatch (around line 550, before the next outer if)

**Context:** Mirror the chatgpt dispatch at lines 482-553. The chatgpt pattern uses helper closures (`getCookies`, `createTab`, `closeTab`, `cdpEvaluate`, `cdpCommand`, `log`) injected into `client.query({...})`. Claude's variant omits `uploadFile` (no file upload in this iteration) — the 5 remaining closures wire to the new service-worker messages added in Tasks 3-6.

**Interfaces:**
- Consumes: `claudeClient.query({...})`, returns `{ response, model, tookMs }`
- Produces: `native/host.cjs` exports a working `CLAUDE_QUERY` branch in `handleToolRequest`.

- [ ] **Step 1: Read the chatgpt dispatch block to mirror it**

Run:

```bash
cd E:/surf-cli && sed -n '465,555p' native/host.cjs
```

Identify:
- The chatgpt dispatch starts with `const result = await chatgptClient.query({...})` (around line 482).
- It ends with `return result;` (around line 550-553).
- The next sibling block in the host is some other message type handler.

- [ ] **Step 2: Add `claudeClient` require**

Find the require block near the top of `native/host.cjs`:

```js
const chatgptClient = require("./chatgpt-client.cjs");
```

Add directly below it:

```js
const claudeClient = require("./claude-client.cjs");
```

- [ ] **Step 3: Add `case "CLAUDE_QUERY":` block after the chatgpt dispatch**

Find the closing brace and `return result;` of the chatgpt dispatch (the last line of the chatgpt block, before the next outer `if (extensionMsg.type === ...)`).

Insert a blank line then the new block. The block starts with `if (extensionMsg.type === "CLAUDE_QUERY") {` and ends with `return result; }`. It is approximately 70 lines. Use this exact body:

```js

  if (extensionMsg.type === "CLAUDE_QUERY") {
    const { query, model, withPage, timeout } = extensionMsg;

    queueAiRequest(async () => {
      let pageContext = null;
      if (withPage) {
        const pageResult = await new Promise((resolve) => {
          const pageId = ++requestCounter;
          pendingToolRequests.set(pageId, {
            socket: null,
            originalId: null,
            tool: "read_page",
            onComplete: resolve,
          });
          writeMessage({ type: "READ_PAGE", id: pageId });
        });
        if (pageResult && pageResult.url) {
          pageContext = pageResult;
        }
      }

      let fullPrompt = query;
      if (pageContext) {
        fullPrompt = `Page: ${pageContext.url}\n\n${pageContext.text}\n\n---\n\n${query}`;
      }

      const result = await claudeClient.query({
        prompt: fullPrompt,
        model,
        timeout,
        getCookies: () => new Promise((resolve) => {
          const cookieId = ++requestCounter;
          pendingToolRequests.set(cookieId, {
            socket: null,
            originalId: null,
            tool: "get_cookies",
            onComplete: (r) => resolve(r),
          });
          writeMessage({ type: "GET_CLAUDE_COOKIES", id: cookieId });
        }),
        createTab: () => new Promise((resolve) => {
          const tabCreateId = ++requestCounter;
          pendingToolRequests.set(tabCreateId, {
            socket: null,
            originalId: null,
            tool: "create_tab",
            onComplete: (r) => resolve(r),
          });
          writeMessage({ type: "CLAUDE_NEW_TAB", id: tabCreateId });
        }),
        closeTab: (tabIdToClose) => new Promise((resolve) => {
          const tabCloseId = ++requestCounter;
          pendingToolRequests.set(tabCloseId, {
            socket: null,
            originalId: null,
            tool: "close_tab",
            onComplete: (r) => resolve(r),
          });
          writeMessage({ type: "CLAUDE_CLOSE_TAB", tabId: tabIdToClose, id: tabCloseId });
        }),
        cdpEvaluate: (tabId, expression) => new Promise((resolve) => {
          const evalId = ++requestCounter;
          pendingToolRequests.set(evalId, {
            socket: null,
            originalId: null,
            tool: "cdp_evaluate",
            onComplete: (r) => resolve(r),
          });
          writeMessage({ type: "CLAUDE_EVALUATE", tabId, expression, id: evalId });
        }),
        cdpCommand: (tabId, method, params) => new Promise((resolve) => {
          const cmdId = ++requestCounter;
          pendingToolRequests.set(cmdId, {
            socket: null,
            originalId: null,
            tool: "cdp_command",
            onComplete: (r) => resolve(r),
          });
          writeMessage({ type: "CLAUDE_CDP_COMMAND", tabId, method, params, id: cmdId });
        }),
        log: (msg) => log(`[claude] ${msg}`),
      });

      return result;
    });

    return;
  }
```

Differences from the chatgpt block:
- `claudeClient` instead of `chatgptClient`.
- All message types renamed (`GET_CLAUDE_COOKIES`, `CLAUDE_NEW_TAB`, `CLAUDE_CLOSE_TAB`, `CLAUDE_EVALUATE`, `CLAUDE_CDP_COMMAND`).
- No `uploadFile` closure (omitted; claude.ai web has no file upload in this iteration).
- No `file` field in the `query` call.
- `[claude]` log prefix instead of `[chatgpt]`.

- [ ] **Step 4: Run `npm run check`**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -10
```

Expected: passes.

- [ ] **Step 5: Run `npm run lint` on the modified files**

```bash
cd E:/surf-cli && npx biome check native/host.cjs native/host-helpers.cjs 2>&1 | tail -30
```

Expected: passes (warnings OK, errors not). If `noNestedPromises` flags anything, refactor the inner Promise to be flat. If `noVoid` flags anything (it shouldn't here), do not use `void expr` to suppress — restructure.

- [ ] **Step 6: Commit**

```bash
cd E:/surf-cli && git add native/host.cjs && git commit -m "feat(host): add CLAUDE_QUERY dispatch

Mirror the chatgpt dispatch in handleToolRequest (lines 465-553).
The dispatch:
- Reads the message via queueAiRequest for serialization.
- Optionally fetches page context if withPage is true.
- Calls claudeClient.query({...}) with 5 helper closures:
  GET_CLAUDE_COOKIES, CLAUDE_NEW_TAB, CLAUDE_CLOSE_TAB,
  CLAUDE_EVALUATE, CLAUDE_CDP_COMMAND.
- No uploadFile closure - claude.ai web has no file upload in
  this iteration.

The [claude] log prefix distinguishes Claude from the other
providers in unified surf logs.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Add Claude to `PRIMARY_ARG_MAP` and `AI_TOOLS` in `cli.cjs`

**Files:**
- Modify: `native/cli.cjs:2727-2735` (`PRIMARY_ARG_MAP`) and `native/cli.cjs:3303` (`AI_TOOLS`)

- [ ] **Step 1: Read `PRIMARY_ARG_MAP`**

Run:

```bash
cd E:/surf-cli && sed -n '2725,2740p' native/cli.cjs
```

Expected: a literal object with keys like `ai`, `gemini`, `chatgpt`, etc.

- [ ] **Step 2: Add `claude: "query",` to `PRIMARY_ARG_MAP`**

Insert a new line after `chatgpt: "query",`:

```js
  chatgpt: "query",
  claude: "query",
  perplexity: "query",
```

(Or in whatever position keeps the AI providers grouped together — alphabetical order is fine.)

- [ ] **Step 3: Read `AI_TOOLS`**

Run:

```bash
cd E:/surf-cli && sed -n '3301,3306p' native/cli.cjs
```

Expected: a const array of AI tool names.

- [ ] **Step 4: Add `"claude"` to `AI_TOOLS`**

Find the line:

```js
const AI_TOOLS = ["smoke", "chatgpt", "gemini", "perplexity", "grok", "aistudio", "aistudio.build", "aimode", "ai"];
```

Change to:

```js
const AI_TOOLS = ["smoke", "chatgpt", "claude", "gemini", "perplexity", "grok", "aistudio", "aistudio.build", "aimode", "ai"];
```

(Insert `"claude"` between `"chatgpt"` and `"gemini"`.)

- [ ] **Step 5: Run `npm run check`**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -10
```

Expected: passes.

- [ ] **Step 6: Commit**

```bash
cd E:/surf-cli && git add native/cli.cjs && git commit -m "feat(cli): add claude to PRIMARY_ARG_MAP and AI_TOOLS

PRIMARY_ARG_MAP tells parseArgs which positional argument is the
primary key for the 'claude' tool. AI_TOOLS tells the CLI which
tools get the extended 5-min default timeout instead of the 30s
default.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Add `claude` Help Entry to `cli.cjs` `TOOLS`

**Files:**
- Modify: `native/cli.cjs:385-500` (the `AI` group in `TOOLS`, around line 387)

**Context:** The TOOLS object exposes the `--help` text. The `AI` group currently lists chatgpt, gemini, perplexity, grok, aistudio, aistudio.build, and aimode. Add a `claude` block matching the chatgpt structure (minus the `file` opt).

- [ ] **Step 1: Read the chatgpt entry to mirror**

Run:

```bash
cd E:/surf-cli && sed -n '385,402p' native/cli.cjs
```

Expected output:

```js
    desc: "AI assistants (ChatGPT, Gemini)",
    commands: {
      "chatgpt": {
        desc: "Send prompt to ChatGPT (uses browser cookies)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          model: "Model: gpt-4o, o1, etc.",
          file: "Attach file",
          timeout: "Timeout in seconds (default: 2700 = 45min)"
        },
        examples: [
          { cmd: 'chatgpt "explain this code"', desc: "Basic query" },
          { cmd: 'chatgpt "summarize" --with-page', desc: "With page context" },
          { cmd: 'chatgpt "review" --file code.ts', desc: "With file" },
          { cmd: 'chatgpt "analyze" --model gpt-4o', desc: "Specify model" },
        ]
      },
```

- [ ] **Step 2: Add `claude` block between `chatgpt` and `gemini`**

Find the closing `}` of the chatgpt block (followed by `,` and a newline, then `"gemini": {`). Insert a blank line then:

```js
      "claude": {
        desc: "Send prompt to Claude.ai (uses browser cookies)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          model: "Model: claude-3-5-sonnet (default), claude-3-opus, etc.",
          timeout: "Timeout in seconds (default: 300 = 5min)"
        },
        examples: [
          { cmd: 'claude "explain this code"', desc: "Basic query" },
          { cmd: 'claude "summarize" --with-page', desc: "With page context" },
          { cmd: 'claude "review this code"', desc: "Code review" },
        ]
      },
```

- [ ] **Step 3: Update the AI group `desc` line**

Find the line:

```js
    desc: "AI assistants (ChatGPT, Gemini)",
```

Change to:

```js
    desc: "AI assistants (ChatGPT, Claude, Gemini)",
```

- [ ] **Step 4: Verify `--help` text shape**

Run:

```bash
cd E:/surf-cli && node -e "
// Quick spot check: ensure TOOLS parses without throwing.
const cli = require('./native/cli.cjs');
console.log('OK');
" 2>&1 | head -5
```

Expected: prints `OK` (or a deprecation warning — that's fine).

If the script complains, read the error and fix the TOOLS block.

- [ ] **Step 5: Run `npm run lint` on `cli.cjs`**

```bash
cd E:/surf-cli && npx biome check native/cli.cjs 2>&1 | tail -30
```

Expected: passes. If `noExcessiveCognitiveComplexity` warns (it shouldn't on this small addition), it's a warning, not an error.

- [ ] **Step 6: Commit**

```bash
cd E:/surf-cli && git add native/cli.cjs && git commit -m "feat(cli): add claude to TOOLS help

Mirror the chatgpt help entry (lines 387-401). Three differences:
- 'claude' name and 'Claude.ai' desc
- No 'file' opt (claude.ai web has no file upload in this iteration)
- Timeout default 300s (5 min) matching host-helpers.cjs:1078

Also updates the AI group desc to include Claude.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: Build the Extension and Run the Smoke Test

**Files:** None modified. This is a verification gate.

**Context:** With the service worker changes (Tasks 3-7), the extension must be rebuilt before the smoke test can dispatch `CLAUDE_QUERY`. The host changes (Tasks 8-11) require running the host against the rebuilt extension. Use the build then smoke pattern from `CLAUDE.md` "Stability test (AI provider self-heal)".

- [ ] **Step 1: Build the extension**

Run:

```bash
cd E:/surf-cli && npm run build 2>&1 | tail -20
```

Expected: build succeeds, `dist/service-worker/index.js` is regenerated, no errors.

If errors: read and fix. Most likely cause: a typo in one of the Tasks 3-7 case statements. The TS compiler usually pinpoints the file and line.

- [ ] **Step 2: Install the native host with the extension ID**

The extension ID for local development is `lhleggnadbemlcmebhibmncbkchdbbod` (per `CLAUDE.md` "Extension loading").

Run:

```bash
cd E:/surf-cli && npm run install:native -- --id lhleggnadbemlcmebhibmncbkchdbbod 2>&1 | tail -10
```

Expected: native host installed and reported ready.

- [ ] **Step 3: Verify the extension is loaded**

Open `chrome://extensions` (or `edge://extensions`) in the user's browser. Confirm the surf extension is loaded (toggle Developer mode, "Load unpacked" → select `E:\surf-cli\dist\`). The extension should be on version 2.8.0.

If the extension is not loaded, this task fails — go to chrome://extensions, click "Load unpacked", select `E:\surf-cli\dist\`.

- [ ] **Step 4: Confirm Claude is logged in**

The browser must have a logged-in session for `claude.ai`. Verify by opening `https://claude.ai/new` and confirming the composer (contenteditable div) is visible — not the login screen.

If the session cookie is absent, the smoke test will fail with `failureKind: login-required`, which the spec marks as **acceptable** for the first run (it indicates the dispatch wiring works; we just lack a session).

- [ ] **Step 5: Run the smoke test**

Run:

```bash
cd E:/surf-cli && npm run test:ai 2>&1 | tail -50
```

Expected: Claude's `failureKind` is **not** `error` or `selector`. Acceptable outcomes:

| Outcome | Meaning | Next step |
|---|---|---|
| Claude returns `"PONG"` | Done | Commit success |
| `failureKind: login-required` | Dispatch works; no session cookie | Proceed to Task 13 (deletion) and add cookies to the live test plan later |
| `failureKind: selector` | Need to read selector-recovery snapshots | Apply the `CLAUDE.md` selector-recovery playbook |
| `failureKind: complete-timeout` | Streaming-state selectors miss | Apply selector-recovery |
| `failureKind: error` with "Unknown tool" | Tasks 8-9 (dispatch) missed | Re-run Task 9 |
| `failureKind: error` other | Debug per the error message |

If the smoke test runs Claude and the dispatch fires (no "Unknown tool" error), Tasks 1-11 succeeded.

- [ ] **Step 6: Read the smoke report if Claude failed**

If Claude failed with `kind: selector` or `kind: complete-timeout`, read:

```bash
RESEARCH=$(ls -t .research/ai-smoke-*/report.json | head -1)
CLAUDE_DIR=$(dirname "$RESEARCH")/claude/snapshots
ls "$CLAUDE_DIR" 2>&1
```

Expected files: `before.txt`, `submitting.txt`, `streaming.txt`, `completed.txt`.

Read the snapshots, diff against `native/claude-client.cjs:15-19` SELECTORS, follow the `CLAUDE.md` selector-recovery playbook (capture 4 snapshots, find completion signal candidates, update selectors.cjs, rerun smoke). This work is **not** committed in this plan — it's a follow-up task tracked under "Streaming-state selector drift" in the spec risks section.

- [ ] **Step 7: Commit the build output (already auto-handled by `npm run build` if dist/ is in git)**

Check:

```bash
cd E:/surf-cli && git status --short dist/ 2>&1 | head -10
```

If `dist/` has changes, they were already produced by `npm run build`. `dist/` is in `.gitignore` (verify with `cat .gitignore | grep dist`). Build artifacts are usually not committed.

This task does not produce a commit — it's a verification gate. If the smoke test passed Claude, proceed to Task 13.

---

## Task 13: Delete the Unused Split-Style Architecture

**Files:**
- Delete: `native/core/` (entire directory, 8 modules + 5 tests)
- Delete: `native/clients/` (entire directory, 7 subdirectories)
- Modify: `biome.json` (remove `native/core/**/*.cjs` and `native/clients/**/*.cjs` from `files.includes`)

**Risk acknowledgment:** This is the highest-risk task in the plan. The deletion is **fully reversible via `git revert`** — but the hidden-caller risk (dynamic require, build-time codegen) means we must verify the build works after deletion before declaring done.

**Why these files:** Per the brainstorm decision (Option A), the architecture has had zero callers for 4 months and the user decided to delete rather than resurrect.

**Files NOT deleted:**
- `native/claude-client.cjs` — the production Claude client, stays.
- `.research/ai-client-fix-sprint-plan.md` — historical reference, kept.
- Any test files in `test/unit/` — those are run by vitest and have nothing to do with the dead architecture.

- [ ] **Step 1: Verify zero callers one more time before deletion**

Run:

```bash
cd E:/surf-cli && grep -rln "createClientRuntime\|require.*core/\|require.*clients/" native/ src/ test/ 2>&1 | head -20
```

Expected output: only the test files inside `native/core/` (which we're deleting) and possibly the `.research/` directory. **No `src/`, no other `native/` files, no `test/unit/`** should appear.

If any caller appears in `src/` or in another `native/` file: STOP. That file needs migration before deletion. Report and update the plan.

- [ ] **Step 2: Delete `native/core/` and `native/clients/`**

Run:

```bash
cd E:/surf-cli && rm -rf native/core native/clients 2>&1 | tail -5
ls native/ 2>&1 | head -20
```

Expected: `native/` no longer contains `core` or `clients` directories. All other entries unchanged.

- [ ] **Step 3: Remove the biome includes**

Open `biome.json` in the editor. The current line is:

```json
    "includes": ["test/**/*.ts", "native/core/**/*.cjs", "native/clients/**/*.cjs"]
```

Change to:

```json
    "includes": ["test/**/*.ts"]
```

(Remove the two `native/...` patterns.)

- [ ] **Step 4: Run `npm run check`**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -20
```

Expected: passes. If TS errors appear mentioning deleted paths, a caller was missed. STOP, investigate, restore the files via `git checkout native/`. Re-investigate.

- [ ] **Step 5: Run `npm run lint`**

```bash
cd E:/surf-cli && npm run lint 2>&1 | tail -20
```

Expected: passes. The biome config no longer lints the deleted directories; no errors should appear for non-existent paths.

- [ ] **Step 6: Run the existing test suite**

```bash
cd E:/surf-cli && npm run test 2>&1 | tail -30
```

Expected: existing tests still pass. The deleted test files (`native/core/*.test.cjs`) are NOT in vitest's include list (they were in `native/core/`, vitest matches `test/**/*.test.ts`), so this should be a no-op for vitest. But run anyway to confirm.

If any test file referenced deleted modules, it would fail. STOP, investigate, restore.

- [ ] **Step 7: Run `npm run build`**

```bash
cd E:/surf-cli && npm run build 2>&1 | tail -20
```

Expected: builds cleanly. The deleted `native/core/` and `native/clients/` were never built (they were `.cjs` CommonJS, while Vite builds `src/`). The build should produce the same `dist/` as before, minus any side effects from the deletion.

- [ ] **Step 8: Verify the deletion is safe**

Run:

```bash
cd E:/surf-cli && git status --short 2>&1 | head -20
```

Expected: only `biome.json` shows as modified. The deletions themselves do NOT appear in `git status` if you're using the standard workflow — they were tracked files and `rm` is enough. `git add -A` will stage them.

- [ ] **Step 9: Commit the deletion**

```bash
cd E:/surf-cli && git add -A && git commit -m "chore: delete unused split-style AI client architecture

The split-style architecture (native/core/, native/clients/) was
added in 27d7f55 [2026-04-14] 'feat(sprint): complete AI client
architecture sprint' but the migration of any provider to use the
runtime was never in scope of that sprint. Four months later, no
provider consumes any of the 8 core modules (~1600 LoC + 900 LoC
tests) or any of the 7 client subdirectories (~830 LoC). All callers
grep-verified to zero before this commit.

Why now: the Claude provider work in Tasks 1-11 made the dead
code obvious to anyone reading the tree. The user decided to
delete rather than resurrect, choosing 'smallest shippable step'
over 'first adopter of unproven architecture'.

Reversibility: this commit is git revert-able. The .research/
ai-client-fix-sprint-plan.md file (the original sprint plan) is
preserved as historical reference.

biome.json: removed native/core/**/*.cjs and native/clients/**/*.cjs
from files.includes since those paths no longer exist.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: Final Verification — Rebuild + Smoke + Help Check

**Files:** None modified. This is the final verification gate.

- [ ] **Step 1: Run the full check + lint + test + build pipeline**

```bash
cd E:/surf-cli && npm run check 2>&1 | tail -10
cd E:/surf-cli && npm run lint 2>&1 | tail -10
cd E:/surf-cli && npm run test 2>&1 | tail -30
cd E:/surf-cli && npm run build 2>&1 | tail -10
```

All four must pass. If any fails: investigate, fix, rerun.

- [ ] **Step 2: Re-run the smoke test**

```bash
cd E:/surf-cli && npm run test:ai 2>&1 | tail -50
```

Expected: Claude appears in the provider list. Its `failureKind` is whatever it was at Task 12 Step 5. If the deletion in Task 13 broke something (it shouldn't), Claude would now fail with an error about a missing module.

- [ ] **Step 3: Verify `surf claude --help` works**

The CLI must recognize the new tool. Run:

```bash
cd E:/surf-cli && node native/cli.cjs claude --help 2>&1 | head -40
```

Expected output: shows the Claude help block from Task 11.

If the help is missing or shows "Unknown tool": Task 11 (TOOLS edit) or Task 10 (PRIMARY_ARG_MAP/AI_TOOLS) was lost. Re-run those commits.

- [ ] **Step 4: Confirm no regressions in other providers**

The smoke test in Step 2 also runs chatgpt, gemini, perplexity, grok, aistudio, aistudio.build, aimode. Compare the failure-kind distribution to the most recent `.research/ai-smoke-*/report.json` (pre-Task-13):

```bash
LATEST=$(ls -t .research/ai-smoke-*/report.json | head -1)
echo "Pre-task baseline: $LATEST"
cat "$LATEST" | python -c "
import json, sys
data = json.load(sys.stdin)
for r in data['results']:
    print(f\"  {r['provider']:15} {r['status']:5} {r.get('failureKind') or '-'}\")
"
echo
echo "Post-task current:"
ls -t .research/ai-smoke-*/report.json | head -1 | xargs cat | python -c "
import json, sys
data = json.load(sys.stdin)
for r in data['results']:
    print(f\"  {r['provider']:15} {r['status']:5} {r.get('failureKind') or '-'}\")
"
```

Expected: the failure kinds for chatgpt/gemini/perplexity/grok/aistudio/aimode are the **same** as before (the change is purely additive).

If any of those 6 providers changed status: STOP. The deletion or a Claude-specific change broke something. Investigate before declaring done.

- [ ] **Step 5: Final commit (only if Step 4 reveals a fix is needed)**

If Step 4 reveals a regression, fix it with a small targeted commit and re-run Steps 1-4.

If everything is green, no commit is needed — the work is done.

---

## Self-Review

After writing the plan, I verified:

**1. Spec coverage:**
- ✅ Task 1: SELECTORS + cookies update (spec lines 116-138)
- ✅ Task 2: Unit tests (spec lines 314-328)
- ✅ Tasks 3-7: Service worker 5 cases + allow-list (spec lines 195-217)
- ✅ Task 8: `mapToolToMessage` case (spec lines 167-181)
- ✅ Task 9: `host.cjs` dispatch (spec lines 145-163)
- ✅ Tasks 10-11: CLI PRIMARY_ARG_MAP, AI_TOOLS, TOOLS (spec lines 183-193)
- ✅ Task 12: Build + smoke (spec lines 330-348)
- ✅ Task 13: Mass deletion + biome config (spec lines 225-261)
- ✅ Task 14: Final verification (spec lines 389-422, Success Criteria checklist)

**2. Placeholder scan:**
- No "TBD", "TODO", "implement later", "fill in details" appear in the plan.
- No "Add appropriate error handling" placeholders.
- Every code-modifying step shows the actual code.
- Every test step shows the actual test code.

**3. Type consistency:**
- `query({...})` signature: 7 fields (prompt, model, timeout, getCookies, createTab, closeTab, cdpEvaluate, cdpCommand, log) — used consistently across Tasks 2 and 9.
- Service-worker message names: `GET_CLAUDE_COOKIES`, `CLAUDE_NEW_TAB`, `CLAUDE_CLOSE_TAB`, `CLAUDE_CDP_COMMAND`, `CLAUDE_EVALUATE` — identical spelling in Tasks 3, 4, 5, 6, 9, allow-list in Task 7, host-helpers case in Task 8.
- `claudeClient` variable name in host.cjs: Task 9 require + dispatch.
- `claudeClient.query({...})`: Test in Task 2, dispatch in Task 9. Same call shape.

**4. Cross-task interface contracts:**
The Interfaces block in Tasks 1, 2, 8, 9 calls out what earlier tasks produce and what later tasks consume. Specifically:
- Task 1 produces the updated `hasRequiredCookies` and `SELECTORS.promptTextarea`. Task 2's tests consume them.
- Tasks 3-7 produce 5 service-worker message handlers and the allow-list entry. Task 9's dispatch reads them via `writeMessage`.
- Task 8 produces the `CLAUDE_QUERY` message mapping. Task 9's dispatch is gated by `extensionMsg.type === "CLAUDE_QUERY"`.
- Tasks 10-11 produce CLI integration. Task 14 verifies it via `--help`.

The plan is internally consistent and covers every spec requirement.
