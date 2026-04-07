---
name: surf-council
description: Run multiple AI providers in parallel and synthesize responses. Use when you need to query ChatGPT, Gemini, and AI Mode simultaneously for better coverage, or when one provider fails and you want automatic fallback.
---

# Surf Council - Multi-AI Parallel Query

Run multiple AI providers simultaneously and get aggregated, synthesized responses.

## Core Function

```javascript
const { councilQuery } = require("./skills/surf-council/council.cjs");

const result = await councilQuery({
  query: "your question here",
  providers: ["chatgpt", "gemini", "aimode"],  // optional, defaults all
  withPage: false,                              // optional, include page context
  perProviderTimeouts: { chatgpt: 300000 },    // optional, ms per provider
  onProviderResult: (result) => { /* called per provider */ }
});
```

## Return Value

```javascript
{
  results: [                    // Array of all provider results
    { success: true, provider: "chatgpt", result: {...}, duration: 45000 },
    { success: false, provider: "gemini", error: "timeout", duration: 180000 },
    { success: true, provider: "aimode", result: {...}, duration: 30000 },
  ],
  synthesized: {...},           // Best response (chatgpt > gemini > aimode priority)
  primaryProvider: "chatgpt",  // Which provider provided the synthesis
  successfulProviders: ["chatgpt", "aimode"],
  failedProviders: [{ provider: "gemini", error: "timeout" }],
  timedOut: false,
}
```

## Provider Priority

When multiple providers succeed, synthesis uses this priority order:

1. **ChatGPT** - Primary (most capable for general queries)
2. **Gemini** - Secondary (good for research, file analysis)
3. **AI Mode** - Tertiary (fast, good for quick lookups)

If only Gemini and AI Mode succeed, Gemini's response is synthesized.

## Timeouts (from COUNCIL_CONFIG)

| Provider | Default Timeout |
|----------|----------------|
| chatgpt  | 300000ms (5 min) |
| gemini   | 180000ms (3 min) |
| aimode   | 120000ms (2 min) |
| overall  | 480000ms (8 min) |

## Examples

### Basic Multi-Provider Query

```javascript
const { councilQuery } = require("./skills/surf-council/council.cjs");

const result = await councilQuery({
  query: "Explain quantum entanglement in simple terms",
});

// result.synthesized contains ChatGPT's response (primary)
// result.successfulProviders = ["chatgpt", "gemini", "aimode"] if all succeed
```

### With Page Context

```javascript
const result = await councilQuery({
  query: "What does this code do?",
  withPage: true,  // Includes current browser page content
});
```

### Custom Providers and Timeouts

```javascript
const result = await councilQuery({
  query: "Quick question",
  providers: ["chatgpt", "aimode"],  // Skip gemini
  perProviderTimeouts: {
    chatgpt: 60000,   // 1 minute for chatgpt
    aimode: 30000,    // 30 seconds for aimode
  },
});
```

### Real-Time Provider Callbacks

```javascript
const result = await councilQuery({
  query: "Research this topic",
  providers: ["chatgpt", "gemini", "aimode"],
  onProviderResult: (providerResult) => {
    if (providerResult.success) {
      console.log(`${providerResult.provider} succeeded in ${providerResult.duration}ms`);
    } else {
      console.log(`${providerResult.provider} failed: ${providerResult.error}`);
    }
  },
});
```

### Handling Partial Failures

```javascript
const result = await councilQuery({
  query: "Complex query",
});

// Even if some providers fail, you get results
if (result.successfulProviders.length > 0) {
  console.log(`Got response from ${result.primaryProvider}`);
}

// Check what failed
for (const failure of result.failedProviders) {
  console.log(`${failure.provider} failed: ${failure.error}`);
}
```

## CLI Equivalent

```bash
# The council runs providers via surf CLI commands
surf chatgpt "query"
surf gemini "query"
surf aimode "query"

# These run in parallel and results are aggregated
```

## Error Handling

- **All providers fail**: `synthesized` is `null`, check `failedProviders` for errors
- **Overall timeout (8 min)**: `timedOut: true`, partial results returned
- **Invalid provider**: Skipped with warning in `failedProviders`
- **Callback errors**: Ignored (non-blocking)

## Zombie Recovery Integration

The council automatically handles zombie window recovery:

- Uses `socket-health.cjs` to check surf socket health before queries
- Uses `zombie-detector.cjs` to detect and clean up orphaned windows
- Recovery happens silently in the background

## When to Use Council

**Use Council when:**
- You need broader coverage (different AIs have different strengths)
- You want automatic fallback if one provider fails
- You're doing research and want multiple perspectives
- You need faster responses (parallel vs sequential)

**Use Single Provider when:**
- You have a preferred provider for your use case
- You need provider-specific features (e.g., Gemini file upload)
- Bandwidth or resource is limited
