# Context Pack: surf-cli Parallel Execution
Generated: 2026-03-17
Research Scope: "apakah dapat dijalankan secara pararel karena saya curiga hanya bisa satu apabila ada lebih dari satu harus menunggu"

---

## 1. External Truth (Online Findings — Version-Pinned)

| Library/Doc | Version | Key Fact | Source URL | Date Accessed |
|-------------|---------|----------|------------|---------------|
| Chrome Extension Native Messaging | Stable | Only ONE native messaging connection per extension | Chrome Extensions Docs | 2026-03-17 |

### Known Constraints
- Chrome extensions can only have ONE persistent connection to a native host via `chrome.runtime.connectNative()`
- All requests must go through this single connection, effectively serializing operations
- No built-in parallelism at the extension level

---

## 2. Repo Truth (Offline Findings)

### Entrypoints
| Symbol | Full Path | Line | Purpose |
|--------|-----------|------|---------|
| socket server | E:\surf-cli\native\host.cjs | 1792 | Listens on /tmp/surf.sock |
| CLI connection | E:\surf-cli\native\cli.cjs | 2854 | Creates socket connection |
| port-manager | E:\surf-cli\src\native\port-manager.ts | 56 | Single native messaging connection |

### Communication Flow
1. **CLI** → creates socket connection → **Host** (multiple concurrent OK)
2. **Host** → writes to stdout → **Extension** (single connection via chrome.runtime.connectNative)
3. **Extension** → CDP commands → **Chrome** (serialized)

### AI Request Queue
| File | Line | Mechanism |
|------|------|-----------|
| native/host.cjs | 60-83 | `queueAiRequest` processes AI requests sequentially with 2s delay |

### Code Evidence

**host.cjs:60-83 - AI Queue:**
```javascript
const aiRequestQueue = [];
let aiRequestInProgress = false;

function queueAiRequest(handler) {
  return new Promise((resolve, reject) => {
    aiRequestQueue.push({ handler, resolve, reject });
    processAiQueue();
  });
}

async function processAiQueue() {
  if (aiRequestInProgress || aiRequestQueue.length === 0) return;
  aiRequestInProgress = true;
  const { handler, resolve, reject } = aiRequestQueue.shift();
  try {
    const result = await handler();
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    aiRequestInProgress = false;
    setTimeout(processAiQueue, 2000);  // 2-second delay
  }
}
```

**port-manager.ts:56 - Single Connection:**
```typescript
nativePort = chrome.runtime.connectNative("surf.browser.host");
```

---

## 3. Assumption Ledger

| ID | Assumption | Status | Evidence |
|----|------------|--------|----------|
| A1 | Multiple CLI can connect concurrently | VERIFIED | Node.js net.createServer handles multiple connections |
| A2 | Extension uses single native messaging | VERIFIED | port-manager.ts:56 - only one connection |
| A3 | AI requests are queued | VERIFIED | host.cjs:60-83 - explicit queue with 2s delay |

---

## 4. FPF Analysis (First Principles)

### Core Problem Definition
- **What:** Can surf-cli run multiple commands in parallel?
- **Why:** Chrome extension architecture limits native messaging to ONE connection

### Invariants (Must Preserve)
- INV-1: Chrome extension can only have one native messaging connection
- INV-2: AI requests require sequential processing with rate limiting

### Root Cause
The serialization happens at the **extension → native host** boundary:
- Multiple CLI instances → OK (socket supports concurrency)
- Host → Extension → BOTTLENECK (single native messaging pipe)

---

## 5. Synthesized Solutions

### Solution Options

| Rank | Hypothesis ID | Title | Approach Summary |
|------|---------------|-------|------------------|
| 1 | S1-Parallel | Multiple Extension Instances | Run multiple Chrome profiles with separate extensions |
| 2 | S2-Queue | Request Prioritization | Implement smart queue in host (not AI-specific) |

### Recommendation
**Winner:** S1-Parallel (Multiple Profiles)
**Rationale:**
- True parallelism requires separate Chrome processes
- Each profile has its own extension instance with its own native messaging connection
- Alternative: Accept serialization as architectural constraint

---

## 6. Contradictions Resolved

| Conflict | Offline Says | Online Says | Resolution |
|----------|-------------|-------------|------------|
| Socket concurrency | Multiple CLI can connect | N/A | Verified - socket supports multiple connections |
| Extension bottleneck | Single connection | Chrome limitation | This is the actual serialization point |

---

## 7. Open Questions / Unanswered

- UQ-1: Could host spawn multiple native messaging pipes? (Answer: No - Chrome API limitation)
- UQ-2: Could we use multiple Chrome profiles for true parallelism? (Yes - each has separate connection)

---

## 8. Negative Constraints (Anti-Patterns)

- NC-1: Do NOT attempt to create multiple native messaging connections - Chrome explicitly forbids this
- NC-2: Do NOT assume parallel execution works at the extension level

---

## 9. Answer Summary

**Question:** "Apakah dapat dijalankan secara pararel?"

**Answer:**
- **Multiple CLI instances:** YES - can connect concurrently to socket
- **True parallel execution:** NO - serialized at extension level due to Chrome's single native messaging connection
- **Your suspicion is correct:** If you run multiple surf commands, they will wait because all requests go through ONE native messaging pipe from extension to host

**Workaround:** Use multiple Chrome profiles (each with separate extension instance) for true parallelism.
