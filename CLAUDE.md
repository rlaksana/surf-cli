# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**surf-cli** is a CLI tool for AI agents to control Chrome browser. It provides a Unix socket-based API that enables any AI agent to automate browser tasks via Chrome DevTools Protocol (CDP), with automatic fallback to chrome.scripting API.

Architecture: `CLI → Unix Socket (/tmp/surf.sock) → Native Host → Chrome Extension → CDP/Scripting API`

## Common Commands

```bash
# Development
npm run dev              # Watch mode with live rebuild
npm run build            # Production build (Vite → native/*.cjs + dist/)
npm run check            # TypeScript type checking
npm run lint             # Biome linting
npm run lint:fix         # Fix lint issues

# Testing
npm run test             # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report

# Additional scripts
npm run format            # Format code with Biome
npm run lint:test        # Lint test files only
npm run test:ui          # Run tests with Vitest UI

# Extension loading
npm run install:native -- --id <extension-id>  # Install native host with extension ID
npm run uninstall:native # Uninstall native host
                         # Binary installs to: ~/.surf/bin/ (add to PATH)

# Extension ID for local development:
# lhleggnadbemlcmebhibmncbkchdbbod (load unpacked from dist/)
```

## Project Structure

```
native/                    # Compiled CLI and native host (TypeScript → CJS via Vite)
  core/                    # Shared AI client infrastructure
    strategy-contracts.cjs  # Typedef contracts: Verdict, SignalEnvelope, etc.
    signal-normalizer.cjs    # CDP + Tampermonkey → SignalEnvelope
    completion-engine.cjs     # 4-signal completion formula
    client-runtime.cjs       # Lifecycle: init → poll → validate → destroy
    cookie-validator.cjs     # Two-phase: sync check + HTTP ping with TTL cache
    ttl-cache.cjs           # Sliding-expiration LRU cache
    rate-limit-detector.cjs  # Priority: CDP 429 → TM 429 → text patterns
    error-detector.cjs      # Priority: CDP 5xx → TM 5xx → text patterns
  clients/                  # Per-AI-client implementations
    chatgpt/               # config.cjs, strategy.cjs, selectors.cjs
    claude/                 # CoT-aware (thinking blocks)
    gemini/                 # Image gen/edit, YouTube analysis
    grok/                  # X.com integration
    perplexity/             # Research mode, zero cookie validation
    aistudio/              # Google AI Studio, app building
    aimode/                # AI mode (udm=50 / nem=143)
  cli.cjs                  # CLI entry point, argument parsing, socket communication
  host.cjs                 # Native host server, request handling, tool execution
  mcp-server.cjs           # Model Context Protocol server implementation
  do-*.cjs                 # Workflow parsing and execution
  network-store.cjs        # Network request capture and storage
  protocol.cjs             # Protocol utilities
  config.cjs               # Config file handling (~/.surf/surf.json)
  device-presets.cjs       # Device emulation presets
dist/                      # Chrome extension (loaded in chrome://extensions)
  service-worker/index.js  # Main service worker for CDP communication
  content/                 # Content scripts (accessibility-tree, visual-indicator)
  options/                 # Extension options page
skills/                    # AI agent skill files for surf integration
```

## Key Architecture Notes

### 1. CLI Flow (native/cli.cjs)
- Entry point registered in package.json `bin`
- Commands organized in `TOOLS` groups: ai, batch, bookmark, cookie, dialog, element, emulate, form, frame, history, input, js, locate, nav, network, page, perf, scroll, search, tab, wait, window, workflow, zoom
- `parseArgs()` handles argument parsing
- Sends JSON requests via Unix socket to host

### 2. Host Flow (native/host.cjs)
- Listens on `/tmp/surf.sock` for incoming requests
- `handleToolRequest()` dispatches tool execution
- `executeBatch()` handles multi-step batch operations
- Automatic retry with exponential backoff for CDP failures
- AI request queue (`processAiQueue`) for sequential AI queries

### 3. Protocol
- JSON over Unix socket: `{type, method, params, id, tabId, windowId}`
- Response: `{type, id, result, error}`
- Auto-capture screenshots after click, type, scroll operations

### 4. AI Clients (native/*-client.cjs)
- **ChatGPT** (chatgpt-client.cjs): Uses browser session, supports file attachments
- **Gemini** (gemini-client.cjs): Image generation/editing, YouTube analysis
- **Grok** (grok-client.cjs): X.com integration, model validation
- **Perplexity** (perplexity-client.cjs): Research mode, file attachments
- **Claude** (claude-client.cjs): Claude API integration
- **AI Studio** (aistudio-client.cjs, aistudio-build.cjs): Google AI Studio, app building
- All use browser cookies—no API keys needed

### 5. MCP Server (native/mcp-server.cjs)
- Implements @modelcontextprotocol/sdk
- Uses StdioServerTransport for stdio-based communication
- Tool schemas defined in TOOL_SCHEMAS constant

### 6. Workflows
- `do` command parses pipe-separated commands: `'go "url" | click e5 | screenshot'`
- do-parser.cjs: Parses workflow syntax
- do-executor.cjs: Executes steps with auto-waits between operations

### 7. Network Capture
- Automatic logging to `/tmp/surf/` (configurable via SURF_NETWORK_PATH)
- 24-hour TTL, 200MB max
- Filter by origin, method, status, type

## Testing

### Running AI client commands (gemini, chatgpt, etc.)

AI client commands require the native host to be running with the Chrome extension connected:

```bash
# 1. Install native host with extension ID
npm run install:native -- --id lhleggnadbemlcmebhibmncbkchdbbod

# 2. Open Chrome with the extension loaded (or reload extension in chrome://extensions)

# 3. Test the command
surf gemini "analisa gambar" --file "path/to/image.png"
```

If you see "Done" instead of results, check:
- Socket exists: `ls -la /tmp/surf.sock`
- Chrome extension is loaded and connected
- Native host process is running

### Unit tests

Tests use Vitest. Run a single test:

```bash
npm run test -- native/tests/<filename>
```

**Test file types:**
- `test/**/*.test.ts` — Vitest tests (auto-included)
- `native/**/*.test.cjs` — Standalone Node scripts (run with `node native/core/*.test.cjs`)
- When adding new test file patterns, update `vitest.config.ts` `include` array

**Running CJS test scripts:** `node native/core/<module>.test.cjs` (syntax check first: `node -c native/core/<module>.cjs`)

## Biome / Linting

- `biome.json` `files.includes` must be manually updated for new source directories (e.g. `native/core/`, `native/clients/`)
- `biome-ignore` format: place `// biome-ignore <rule>` on the **line before** the issue (not inline, not `-line` suffix)
- `noVoid` is enabled — never use `void expr` to suppress unused variable warnings
- `noNestedPromises` — avoid `.then()` inside `.then()` callbacks; flatten chains
- Empty `catch {}` blocks require a comment: `catch { /* reason */ }`
- `noExcessiveCognitiveComplexity` is a **warning** only — does not fail the build
- CRLF→LF git warnings on Windows are harmless (line-ending normalization)

**Fix-and-check workflow:**
```bash
npx biome check --write native/core/ native/clients/   # auto-fix new sprint files
npm run lint                                            # verify (warnings OK, errors not)
```

## CLI Aliases

| Alias | Command |
|-------|---------|
| `snap` | `screenshot` |
| `read` | `page.read` |
| `find` | `search` |
| `go` | `navigate` |
| `net` | `network` |

## Command Groups

| Group | Commands |
|-------|----------|
| `workflow` | `do`, `workflow.list`, `workflow.info`, `workflow.validate` |
| `window.*` | `new`, `list`, `focus`, `close`, `resize` |
| `tab.*` | `list`, `new`, `switch`, `close`, `name`, `unname`, `named`, `group`, `ungroup`, `groups`, `reload` |
| `scroll.*` | `top`, `bottom`, `to`, `info` |
| `page.*` | `read`, `text`, `state` |
| `locate.*` | `role`, `text`, `label` |
| `element.*` | `styles` |
| `frame.*` | `list`, `switch`, `main`, `js` |
| `wait.*` | `element`, `network`, `url`, `dom`, `load` |
| `cookie.*` | `list`, `get`, `set`, `clear` |
| `emulate.*` | `network`, `cpu`, `geo`, `device`, `viewport`, `touch` |
| `perf.*` | `start`, `stop`, `metrics` |
| `network.*` | `get`, `body`, `curl`, `origins`, `clear`, `stats`, `export`, `path` |

## AI Mode (aimode)

- `surf aimode "query"` - Uses udm=50 (auto mode, has copy button)
- `surf aimode "query" --pro` - Uses nem=143 (pro mode)

## Process Management

- Find surf PID: `wmic process where "name='node.exe'" get processid,commandline`
- Kill only surf: `taskkill //F //PID <pid>` (NOT all node processes)

## Debugging AI Clients

- Use `surf tab.new` for testing - don't navigate in user's active tab
- Find selectors with: `surf js "document.querySelector('...').outerHTML"`
- Use `surf page.read` to see accessibility tree with element refs

## Key Fixes (see `git log` for details)
- ChatGPT selectors: `textarea[placeholder*="How can I help you"]`, `button[aria-label="Send message"]`
- Cookie check: accepts `sessionKey`, `anthropic-device-id`, or `ARID` cookies
- Completion algorithm: hybrid signal-based (isSemanticComplete + isInteractionReady + isTransportIdle)

## Extension Structure (dist/)

```
dist/
  service-worker/index.js    # Main service worker, CDP communication
  content/
    accessibility-tree.js    # Page accessibility tree extraction
    visual-indicator.js      # Visual element labels overlay
  options/
    options.html/js          # Extension settings page
  icons/                    # Extension icons (16, 48, 128px)
  manifest.json             # Extension manifest
```

## Configuration

- Config location: `~/.surf/surf.json` (user) or `./.surf/` (project)
- Multi-browser support: `chrome`, `chromium`, `brave`, `edge`, `arc`, `helium`

## MCP Server

The MCP server (`native/mcp-server.cjs`) provides Model Context Protocol integration:
- Uses `@modelcontextprotocol/sdk`
- Tool schemas defined in `TOOL_SCHEMAS` constant
- Communication via stdio (`StdioServerTransport`)

## Important Implementation Details

- Screenshot resize uses `sips` (macOS) or ImageMagick (Linux)
- CDP falls back to `chrome.scripting` API on restricted pages
- Screenshots fallback to `captureVisibleTab` when CDP capture fails
- Element refs (`e1`, `e2`...) are stable identifiers from accessibility tree
- First CDP operation on new tab takes ~100-500ms (debugger attachment)
- Cannot automate `chrome://` pages (Chrome restriction)

## Troubleshooting

- Socket not found: Ensure native host is running (`npm run install:native`)
- Extension not loading: Check chrome://extensions for errors
- CDP failures: Ensure debuggable tabs exist
- Permission denied on socket: Check that no other surf instance is running

## AI Completion Detection — Broken Selector Recovery Guide

When `surf <ai> "PONG"` returns empty, `"Done"`, or times out even though the response is visible in the browser, the bug is almost always a **selector that no longer matches the live UI**. This section is the playbook.

### The 30-second diagnostic

```bash
# 1. Confirm the AI is actually responding in the browser (not surf's fault)
# 2. Capture the accessibility tree the detector sees
surf --tab-id <TAB_ID> page.read > snapshot.txt

# 3. Grep for the suspect selector
grep -F "data-testid" snapshot.txt
grep -F "class*=" snapshot.txt
grep -F "thinking" snapshot.txt
```

If the substring the selector expects is **absent from the snapshot**, the selector is broken. If it's **present in BOTH before-submit and after-complete states**, the selector is too greedy (false positive).

### Architecture (read once, refer forever)

- **Substrate:** All completion detection uses CDP `Page.read` accessibility tree text — NOT live DOM, NOT CSS, NOT `Runtime.evaluate`.
- **Matcher:** `findInContent(selectorChain, pageContent)` does **substring matching** on the serialized a11y tree. Strategies tried in order: exact match → strip outer quotes → for `[attr="val"]`, match `attr="val"` without brackets.
- **Formula** (`E:\surf-cli\native\core\completion-engine.cjs:139`):
  ```
  done = (isSemanticComplete.complete OR isInteractionReady.ready)
     AND (isTransportIdle.idle OR maxTimeout.timedOut)
  ```
  - `isInteractionReady.ready` = stop button **NOT found** in tree (`!findInContent(stopButton, ...).found`)
  - `isSemanticComplete.complete` = done token **found** in tree
- **Per-client state machines:** Claude forces incomplete if `thinkingBlock` is found. Perplexity/Gemini use plain formula. ChatGPT uses plain formula (and works).

### Selector rules (must follow)

| ✅ Use | ❌ Avoid | Why |
|---|---|---|
| `[data-testid="stop-button"]` | `[class*="thinking"]` | Wildcards match UI chrome (settings toggles, etc.) |
| `aria-label="Stop generating"` | `'a[href*="/search/"]'` | Literal substrings rarely appear in a11y tree |
| `aria-busy="true"` (specific) | `'[class*="done"]'` | Too broad — matches "Done" as English word |
| `data-state="thinking"` | Bare string `"message-content"` | Typo trap — no class dot prefix |
| Specific data-testid from current UI | Guessed class names from memory | UIs change every release |

### Fix protocol (per client)

1. **Capture 4 snapshots** in `E:\surf-cli\.research\selector-recovery-<date>\snapshots\`:
   - `before.txt` — empty chat, just input box
   - `submitting.txt` — right after Enter pressed
   - `streaming.txt` — mid-stream, tokens arriving
   - `completed.txt` — response fully shown, no more activity

2. **Diff** with grep/diff to find:
   - Substrings appearing **only in `completed.txt`** → completion signal candidates
   - Substrings appearing **only in `streaming.txt`** → still-streaming signal candidates
   - Substrings appearing **in all states** → UI chrome (avoid)

3. **Edit** the client's `selectors.cjs`:
   ```js
   // E:\surf-cli\native\clients\<name>\selectors.cjs
   module.exports = {
     stopButton: [...],   // substring absent in completed state
     doneToken:  [...],   // substring present only in completed state
     thinkingBlock: [...], // Claude only: present only in streaming state
   };
   ```

4. **Test** with the deterministic PONG query:
   ```bash
   surf <name> "Reply with the single word PONG and nothing else"
   # Expected: returns "PONG" within 30s, not "Done" or empty
   ```

5. **Regression** check: re-run `surf chatgpt "PONG"` and `surf aimode "PONG"` to confirm no breakage.

### Known client-specific gotchas (as of 2026-06)

| Client | Gotcha | Fix location |
|---|---|---|
| **chatgpt** | Working baseline. Uses `data-testid="stop-button"`, `data-testid="done"`. | `E:\surf-cli\native\clients\chatgpt\selectors.cjs` |
| **claude** | CoT: forced incomplete when `thinkingBlock` selector matches. Avoid `[class*="thinking"]` — matches "thinking mode" settings toggle. | `E:\surf-cli\native\clients\claude\selectors.cjs` + `strategy.cjs` |
| **perplexity** | "Preparing to reply" pre-stream phase may keep the response spinner visible. `a[href*="..."]` literal substrings don't work. | `E:\surf-cli\native\clients\perplexity\selectors.cjs` |
| **gemini** | `doneToken: "message-content"` was a typo (should be `.message-content`). `mat-progress-bar` may persist after stream end. | `E:\surf-cli\native\clients\gemini\selectors.cjs` |
| **grok** | Domain moved `x.com/i/grok` → `grok.com`. Cookies: `auth_token` (x.com) OR `x-userid` (grok.com). | `E:\surf-cli\native\grok-client.cjs` + `E:\surf-cli\src\service-worker\index.ts` (GET_TWITTER_COOKIES + GROK_NEW_TAB) |
| **aistudio** | Same Google auth as Gemini. Uses `data-testid="stop-generating"`. | `E:\surf-cli\native\clients\aistudio\selectors.cjs` |
| **aimode** | No login required (public Google search `udm=50`). Always works. | `E:\surf-cli\native\clients\aimode\selectors.cjs` |

### Quick selector edit template

```js
// E:\surf-cli\native\clients\<client>\selectors.cjs
module.exports = {
  responseContainer: [
    // 1st choice: specific data-testid (most stable)
    '[data-testid="response"]',
    // 2nd choice: specific aria-label
    'aria-label="Response"',
    // 3rd choice: class with strong prefix (avoid wildcards)
    '[class^="response-container"]',
  ],
  stopButton: [
    'aria-label="Stop generating"',  // most portable
    'data-testid="stop-button"',
    'aria-busy="true"',
  ],
  doneToken: [
    'data-testid="done"',           // specific wins
    'aria-label="Copy"',            // copy button appears post-stream
    'aria-label="Regenerate"',
  ],
  // Claude ONLY: force-incomplete while this matches
  thinkingBlock: [
    'data-state="thinking"',         // specific
    'aria-busy="true"',              // generic
    // NEVER use '[class*="thinking"]' — matches UI chrome
  ],
  rateLimitText: [/rate limit/i, /too many requests/i, /try again in/i],
  errorText: [/something went wrong/i, /error/i, /failed/i],
};
```

### After fixing selectors

1. **Reload extension** in `edge://extensions/` or `chrome://extensions/`
2. **Re-test** with the PONG query
3. **Save snapshot artifacts** in `.research/selector-recovery-*/snapshots/` for future reference
4. **Document** any new gotcha in this section

### When selector fix doesn't help

If the selector matches correctly but the response is still missed, the next suspects are:

1. **Cookie/domain drift** — service moved domains. Check `document.cookie` on the active tab via `surf js "return document.cookie"`. Update `hasRequiredCookies` in the client's `.cjs` file.
2. **maxTimeout too short** — Thinking models (o1, Grok Thinking, Claude Extended) can take 60s+. Check `E:\surf-cli\native\clients\<name>\config.cjs` for `completion.maxTimeout` and `timeout.response`.
3. **Rate limit / error swallowed** — If the page shows a rate-limit or error, the completion detector returns done:false. Check `rateLimitText` and `errorText` patterns in `selectors.cjs` against the current page.
4. **Selector on a different subtree** — The a11y tree may not include the element if it's inside a Shadow DOM or `display:none`. Use `surf js "document.querySelectorAll('...').length"` to verify the element exists in the live DOM.

### Reference: Live snapshot of all AI service UIs (2026-06-05)

Captured via `surf --tab-id <id> page.read` against logged-in Edge session:

- `E:\surf-cli\.research\surf-completion-detection-20260605-081739\snapshots\claude-after.txt` — Claude empty chat
- `E:\surf-cli\.research\surf-completion-detection-20260605-081739\snapshots\perplexity-after.txt` — Perplexity empty chat
- `E:\surf-cli\.research\surf-completion-detection-20260605-081739\snapshots\gemini-after.txt` — Gemini empty chat
- `E:\surf-cli\.research\surf-completion-detection-20260605-081739\snapshots\grok-after.txt` — Grok empty chat

Use these as baseline to compare against new captures when selectors need re-validation.
