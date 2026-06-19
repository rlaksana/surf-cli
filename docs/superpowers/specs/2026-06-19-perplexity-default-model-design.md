# Perplexity Default Model → `pplx_pro_upgraded`

**Date:** 2026-06-19
**Status:** Approved — ready for implementation
**Scope:** 5 files, ~10 lines of substantive change

## Goal

Change the default model used by `surf perplexity "..."` from
`claude46sonnetthinking` (Claude Sonnet 4.6 Thinking) to `pplx_pro_upgraded`
(Perplexity's auto-routing Pro model). All other Perplexity behavior,
selectors, validation, and CLI surface remain unchanged.

## Why

`pplx_pro_upgraded` is Perplexity's router-style model: it auto-selects the
best underlying Pro-tier model per query. The current default
(`claude46sonnetthinking`) was picked because it won head-to-head PONG format
compliance tests against other Pro thinking models, but it locks users into
a single reasoning model. The router gives Perplexity the freedom to pick
the best fit per query, which is the better default for general use.

The user has verified that `pplx_pro_upgraded` is accepted by Perplexity's
deep-link URL hash (`https://www.perplexity.ai/#?...&model=pplx_pro_upgraded`)
and produces a valid response.

## Non-Goals

- Not changing any other AI client's default.
- Not removing `claude46sonnetthinking` as a usable value — users can still
  pass `surf perplexity "..." --model claude46sonnetthinking` to get the
  old behavior.
- Not making the default configurable via `~/.surf/surf.json` (YAGNI — no
  other client has a config-file default override).
- Not touching the fallback `selectModel()` UI-clicking path
  (`perplexity-client.cjs:209-296`). The deep-link is the primary path; if
  the live PONG test passes, the fallback is not exercised.

## Files to Change (5)

### 1. `native/host.cjs`

**Line 695** — change the runtime default constant:

```js
// Before
const PERPLEXITY_DEFAULT_MODEL = "claude46sonnetthinking";

// After
const PERPLEXITY_DEFAULT_MODEL = "pplx_pro_upgraded";
```

**Lines 688-694** — update the surrounding comment block to reflect the
new rationale. The current comment claims the constant was picked for PONG
format compliance. Replace with a short note that `pplx_pro_upgraded` is
Perplexity's auto-router, and that users can override with `--model <id>`
from `https://www.perplexity.ai/rest/models/config`. Keep the Max-tier
warning (`gpt55_thinking`, `claude48opusthinking` are silently rejected for
Pro users).

### 2. `native/cli.cjs`

**Line 435** — update command description:

```js
// Before
desc: "Search with Perplexity AI (uses browser session, default: Claude Sonnet 4.6 Thinking)",

// After
desc: "Search with Perplexity AI (uses browser session, default: pplx_pro_upgraded router)",
```

**Lines 441-443** — replace the help text for `--model`. The current text
advertises a static list of "Top Pro thinking models" that
`pplx_pro_upgraded` is not part of. Replace with a pointer to
`/rest/models/config` and a note that the default is the auto-router:

```js
// Before
model:
  "Model id. Default: claude46sonnetthinking. Top Pro thinking models: " +
  "gpt54_thinking, gemini31pro_high, claude46sonnetthinking, kimik26thinking, " +
  "nv_nemotron_3_ultra. See https://www.perplexity.ai/rest/models/config for the full list.",

// After
model:
  "Model id. Default: pplx_pro_upgraded (auto-router). Override with any " +
  "reasoning_model id from https://www.perplexity.ai/rest/models/config. " +
  "Max-tier models (e.g. gpt55_thinking, claude48opusthinking) are " +
  "silently rejected for Pro users.",
```

**Line 452** — update first example description:

```js
// Before
desc: "Default model (Claude Sonnet 4.6 Thinking)",

// After
desc: "Default model (pplx_pro_upgraded router)",
```

The remaining examples at `:460` and `:464` still demonstrate explicit
`--model <id>` usage with named thinking models and remain valid — no
change needed.

### 3. `skills/surf/SKILL.md`

This file is loaded by AI agents every session. Four mentions of the
default model must be updated to avoid stale-doc risk.

**Line 62:**

```md
// Before
**Default model:** `claude46sonnetthinking` (Claude Sonnet 4.6 Thinking). Picked as the most reliable for exact-format output in head-to-head PONG tests against other Pro thinking models.

// After
**Default model:** `pplx_pro_upgraded` (Perplexity auto-routing Pro model). Picks the best underlying Pro-tier model per query. Override with `--model <id>` from `/rest/models/config` for a specific model.
```

**Line 65** (in the bash example):

```md
// Before
surf perplexity "what is quantum computing"            # Default: Claude Sonnet 4.6 Thinking

// After
surf perplexity "what is quantum computing"            # Default: pplx_pro_upgraded (router)
```

**Line 77** (in the "Top Pro thinking picks" table):

```md
// Before
| `claude46sonnetthinking` (default) | Best format compliance |

// After
| `pplx_pro_upgraded` (default) | Perplexity auto-routes per query |
```

**Line 588** (in the tips section):

```md
// Before
15. **Perplexity default = Claude Sonnet 4.6 Thinking** - Picked for format compliance; override with `--model <id>` from `/rest/models/config`. Perplexity's "Thinking" toggle is the `reasoning_model` field, not a URL flag — pass that id to `?model=...`

// After
15. **Perplexity default = pplx_pro_upgraded** (auto-router; override with `--model <id>` from `/rest/models/config`). Perplexity's "Thinking" toggle is the `reasoning_model` field, not a URL flag — pass that id to `?model=...`
```

## What Is NOT Changing

- **`native/perplexity-client.cjs`** — accepts `model` as a string and
  passes it through to the deep-link URL hash (`:24-34`, `:580`, `:616`).
  No model-specific logic in this file.
- **`native/clients/perplexity/{config,strategy,selectors}.cjs`** — no
  model-specific logic.
- **`native/tests/ai-provider-smoke.test.cjs`** — asserts
  `stdout: "PONG\n"`, model-agnostic. Will continue to pass.
- **`docs/superpowers/specs/2026-06-12-ai-provider-stability-test-design.md`**
  — historical research artifact documenting the test design. The
  rationale for the default model has shifted, but the test design itself
  is unchanged. Leave as historical record.
- **`native/host.cjs:697-700`** — the call site
  `model: model || PERPLEXITY_DEFAULT_MODEL` is unchanged; it picks up
  the new constant automatically.

## Verification

### Pre-implementation

- `git status` clean before edit.
- `npm run check` (TypeScript) and `npm run lint` (Biome) pass on the
  un-edited `main` branch.

### Post-implementation

1. `npm run check` — confirm no new type errors.
2. `npm run lint` — confirm no new lint errors. Biome's
   `noExcessiveCognitiveComplexity` is a warning only and does not fail
   the build; existing rule state is preserved.
3. `npm run build` — confirm production build succeeds.
4. `git diff` — review the 5-file change set is bounded and matches the
   spec.
5. `surf perplexity --help` — confirm:
   - Command desc shows new default.
   - `--model` help text points to `/rest/models/config`.
   - First example says `pplx_pro_upgraded (router)`.
6. **Live PONG smoke (primary verification):**
   ```bash
   surf perplexity "Reply with the single word PONG and nothing else"
   ```
   Expected: returns `PONG\n` within 30-60s. This proves:
   - The new default constant flows through CLI → host → client.
   - The deep-link URL hash contains `model=pplx_pro_upgraded`.
   - Perplexity accepts the id (not silently ignored — see R1).
7. **Override regression test:**
   ```bash
   surf perplexity "Reply with the single word PONG and nothing else" --model claude46sonnetthinking
   ```
   Expected: also returns `PONG\n`. Proves the `--model` override path
   still works and the previous default model is still reachable.
8. **AI provider stability suite** (optional, longer):
   ```bash
   npm run test:ai
   ```
   Runs PONG smoke against all 7 AI providers. Worth running to detect
   any cross-provider regression. `pplx_pro_upgraded` is a router, so
   its PONG output may be less deterministic than a single named
   thinking model — if the test flakes, the failure is likely the test
   itself, not the production code.

## Risks

### R1 (medium) — Silent fallback if id is invalid

`native/perplexity-client.cjs:21-22` states: *"Unknown models/focus/space
are silently ignored by Perplexity — caller is responsible for passing
valid values."* If `pplx_pro_upgraded` is not a valid `reasoning_model`
id, Perplexity falls back to its own site default and the change is a
silent no-op.

**Mitigation:** The user has confirmed this id is verified manually.
Verification step 6 above (live PONG smoke) is the operational proof:
if the response is empty, broken, or "Done", the id was rejected.

### R2 (low) — Router output variability

Router models may produce more variable output for the PONG smoke test
than a single named thinking model. If a future test asserts exact
format, it could flake. The current
`ai-provider-smoke.test.cjs:34,62` only asserts `"PONG\n"`, so no
immediate concern.

### R3 (low) — Stale skill doc

If the constant in `host.cjs` changes but `skills/surf/SKILL.md` is not
updated, AI agents will give users wrong advice ("default is
claude46sonnetthinking"). Mitigated by touching all 4 mentions
explicitly listed above.

### R4 (very low) — Other call sites

`rg` confirms only one runtime call site for the default
(`native/host.cjs:700`) and one constant definition (`host.cjs:695`).
No risk of partial migration.

## Diff Summary

| File | Lines changed | Type |
|---|---|---|
| `native/host.cjs` | 695 (constant) + 688-694 (comment) | 1-line value + ~6-line comment |
| `native/cli.cjs` | 435, 441-443, 452 | 1-line desc + 3-line help + 1-line example |
| `skills/surf/SKILL.md` | 62, 65, 77, 588 | 4 doc-line updates |
| **Total** | **~12 substantive lines** | **3 files** |

The README/CHANGELOG and `docs/superpowers/specs/` (this file) are
meta-documentation and not counted.
