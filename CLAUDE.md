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
npm run install:native  # Install native host (requires extension ID from chrome://extensions)
npm run uninstall:native # Uninstall native host
                         # Binary installs to: ~/.surf/bin/ (add to PATH)
```

## Project Structure

```
native/                    # Compiled CLI and native host (TypeScript → CJS via Vite)
  cli.cjs                  # CLI entry point, argument parsing, socket communication
  host.cjs                 # Native host server, request handling, tool execution
  mcp-server.cjs           # Model Context Protocol server implementation
  *-client.cjs             # AI clients (chatgpt, gemini, grok, perplexity, claude, aistudio)
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

Tests use Vitest. Run a single test:

```bash
npm run test -- native/tests/<filename>
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

## Surf Claude Fix History

- Selectors: `textarea[placeholder*="How can I help you"]`, `button[aria-label="Send message"]`, `.font-claude-response-body`
- Cookie check: accepts `sessionKey`, `anthropic-device-id`, or `ARID` cookies

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
