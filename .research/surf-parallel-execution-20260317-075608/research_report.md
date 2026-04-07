# Research Report: surf-cli Parallel Execution

## Summary

**Question:** "Apakah dapat dijalankan secara pararel karena saya curiga hanya bisa satu apabila ada lebih dari satu harus menunggu"

**Answer:** Your suspicion is **CORRECT**.

---

## Key Findings

### 1. Socket Level (CLI → Host)
- ✅ Multiple CLI instances CAN connect concurrently
- Node.js `net.createServer` handles multiple socket connections

### 2. The Bottleneck (Extension → Native Host)
- ❌ **Single native messaging connection** from extension to native host
- Chrome extension API limitation: only ONE connection per extension
- All CDP commands (click, type, navigate) serialize through this one pipe

### 3. AI Request Queue
- Explicit queue in `host.cjs` lines 60-83
- 2-second delay between each AI request

---

## Architecture Flow

```
CLI Instance 1 ──┐
CLI Instance 2 ──┼──→ Unix Socket (/tmp/surf.sock) ──→ Host ──→ Extension
CLI Instance N ──┘                                          │
                                                              ▼
                                                    Native Messaging (SINGLE)
                                                              │
                                                              ▼
                                                    Chrome CDP Commands
```

---

## Evidence

**Single Connection (port-manager.ts:56):**
```typescript
nativePort = chrome.runtime.connectNative("surf.browser.host");
```

**Explicit Queue (host.cjs:60-83):**
```javascript
const aiRequestQueue = [];
let aiRequestInProgress = false;
// 2-second delay between each AI request
setTimeout(processAiQueue, 2000);
```

---

## Workaround for True Parallelism

Use **multiple Chrome profiles**:
1. Create separate Chrome profiles
2. Load surf extension in each profile
3. Each profile has its own native messaging connection

---

## Conclusion

The serialization happens at the **extension → native host** boundary, not at the socket level. Multiple surf commands will wait because Chrome extensions can only maintain ONE native messaging connection.
