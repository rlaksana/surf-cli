# Perplexity Default Model → `pplx_pro_upgraded` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the default model used by `surf perplexity "..."` from `claude46sonnetthinking` to `pplx_pro_upgraded` (Perplexity's auto-routing Pro model), and keep all help text and skill documentation consistent with the new default.

**Architecture:** Three source files change, no new files. The runtime default constant lives in `native/host.cjs:695`; user-facing help text in `native/cli.cjs`; the AI-agent skill doc in `skills/surf/SKILL.md` references the same default in 4 places. Change all of them in lockstep to avoid stale-doc risk. No behavior code in the client itself (`native/perplexity-client.cjs`) needs to change — it already accepts `model` as a string and passes it through the deep-link URL hash.

**Tech Stack:** Node.js CJS (existing), Vitest (existing), Biome (existing). No new dependencies.

---

## File Structure

```
native/
  host.cjs                # MODIFY: default constant + comment block (lines 688-695)
  cli.cjs                 # MODIFY: help text (lines 435, 441-443, 452)

skills/
  surf/
    SKILL.md              # MODIFY: 4 default-model mentions (lines 62, 65, 77, 588)
```

No new files. No file splits. No new tests — the existing `native/tests/ai-provider-smoke.test.cjs` is model-agnostic (asserts `"PONG\n"` regardless of model), so it serves as the smoke check.

---

## Global Constraints

- **No behavioral code changes** — only string constants, help text, and doc text. The Perplexity client (`native/perplexity-client.cjs`) is untouched.
- **Surgical diff** — every changed line must trace to this spec. No drive-by refactors, no formatting-only changes, no comment cleanups on adjacent lines.
- **CRLF on Windows** — Biome's `git warning: LF will be replaced by CRLF` is harmless and expected on Windows (line-ending normalization). Do not "fix" it.
- **Biome's `noExcessiveCognitiveComplexity`** is warning-only, not a build failure.
- **Biome's `biome-ignore` format** — if a new lint ignore is needed, place `// biome-ignore <rule>` on the **line before** the issue, not inline, not with `-line` suffix.
- **No `git add -A`** — stage specific files only. The project's `.gitignore` covers tooling, but explicit staging prevents surprise commits.
- **Branch from `main`** — current branch is `main` and working tree is clean. Do the work directly on `main` since this is a 2-commit change with a single-author trail; do not create a feature branch.
- **Commit message style** — Conventional Commits with scope: `fix(perplexity): ...` or `docs(perplexity): ...` or `chore(perplexity): ...`. Body optional, but include the "why" if non-obvious.
- **Skill doc freshness** — `skills/surf/SKILL.md` is loaded by AI agents every session. Stale default-model claims will mislead users. All 4 mentions must be updated in the same task as the code change.
- **No unrequested features** — do not add config-file default overrides, do not add env var overrides, do not refactor `selectModel()`. YAGNI.

---

## Task 1: Change source-code default constant + CLI help text

**Files:**
- Modify: `native/host.cjs:688-695`
- Modify: `native/cli.cjs:435, 441-443, 452`

**Interfaces:**
- Consumes: existing `PERPLEXITY_DEFAULT_MODEL` constant in `host.cjs:695`; existing `model: "..."` string in the `cli.cjs` perplexity tool definition
- Produces: the constant value `"pplx_pro_upgraded"` flowing through `host.cjs:700` (`model: model || PERPLEXITY_DEFAULT_MODEL`) and the updated help text shown by `surf perplexity --help`

- [ ] **Step 1: Verify clean working tree**

Run: `git status --porcelain`
Expected: empty output. If any files are dirty, stop and surface to user before proceeding.

- [ ] **Step 2: Update the constant in `native/host.cjs`**

Open `native/host.cjs` and navigate to line 695. Replace the constant value AND the comment block at lines 688-694.

Replace the entire block from line 688 through line 695 (8 lines) with:

```javascript
      // Default to pplx_pro_upgraded: Perplexity's auto-routing Pro model.
      // Picks the best underlying Pro-tier model per query. User can override
      // with --model <id>. See https://www.perplexity.ai/rest/models/config
      // for the full list; the `reasoning_model` field is what you pass for
      // Thinking mode. Max-tier models (e.g. gpt55_thinking, claude48opusthinking)
      // require a Max subscription and are silently rejected by Perplexity for
      // Pro users — prefer *_thinking ids marked as `tier: pro`.
      const PERPLEXITY_DEFAULT_MODEL = "pplx_pro_upgraded";
```

- [ ] **Step 3: Update command description in `native/cli.cjs`**

Open `native/cli.cjs` and navigate to line 435. The line is part of the `perplexity:` tool definition in the help-text block. Replace the entire `desc:` line with:

```javascript
        desc: "Search with Perplexity AI (uses browser session, default: pplx_pro_upgraded router)",
```

- [ ] **Step 4: Update `--model` help text in `native/cli.cjs`**

Open `native/cli.cjs` and navigate to lines 441-443. The block reads:

```javascript
          model:
            "Model id. Default: claude46sonnetthinking. Top Pro thinking models: " +
            "gpt54_thinking, gemini31pro_high, claude46sonnetthinking, kimik26thinking, " +
            "nv_nemotron_3_ultra. See https://www.perplexity.ai/rest/models/config for the full list.",
```

Replace the entire 3-line block (lines 441-443) with:

```javascript
          model:
            "Model id. Default: pplx_pro_upgraded (auto-router). Override with any " +
            "reasoning_model id from https://www.perplexity.ai/rest/models/config. " +
            "Max-tier models (e.g. gpt55_thinking, claude48opusthinking) are " +
            "silently rejected for Pro users.",
```

- [ ] **Step 5: Update first example description in `native/cli.cjs`**

Open `native/cli.cjs` and navigate to line 452. Replace the `desc:` line of the first example with:

```javascript
            desc: "Default model (pplx_pro_upgraded router)",
```

- [ ] **Step 6: Run TypeScript and lint checks**

Run: `npm run check`
Expected: pass with no new errors. Existing warnings (if any) remain.

Run: `npm run lint`
Expected: pass. `noExcessiveCognitiveComplexity` warnings are OK; only `error`-level violations fail the build.

- [ ] **Step 7: Run production build**

Run: `npm run build`
Expected: build succeeds. New file artifacts under `native/*.cjs` and `dist/` should reflect the updated string constants.

- [ ] **Step 8: Review the diff**

Run: `git diff native/host.cjs native/cli.cjs`
Expected: 2 files changed. Verify:
- `host.cjs`: constant value changed; comment block updated; no other lines touched.
- `cli.cjs`: 3 distinct changes (line 435, lines 441-443, line 452). No other lines touched.

If anything else is changed, revert and start over — surgical scope violated.

- [ ] **Step 9: Commit**

```bash
git add native/host.cjs native/cli.cjs
git commit -m "fix(perplexity): change default model to pplx_pro_upgraded router"
```

---

## Task 2: Update skill doc to match new default

**Files:**
- Modify: `skills/surf/SKILL.md:62, 65, 77, 588`

**Interfaces:**
- Consumes: existing 4 mentions of the old default in `skills/surf/SKILL.md`
- Produces: skill doc that matches `native/host.cjs:695` constant. AI agents reading the doc will see the new default and example consistent with the code.

- [ ] **Step 1: Update the default-model callout at line 62**

Open `skills/surf/SKILL.md` and navigate to line 62. The current line reads:

```markdown
**Default model:** `claude46sonnetthinking` (Claude Sonnet 4.6 Thinking). Picked as the most reliable for exact-format output in head-to-head PONG tests against other Pro thinking models.
```

Replace it with:

```markdown
**Default model:** `pplx_pro_upgraded` (Perplexity auto-routing Pro model). Picks the best underlying Pro-tier model per query. Override with `--model <id>` from `/rest/models/config` for a specific model.
```

- [ ] **Step 2: Update the bash example comment at line 65**

Open `skills/surf/SKILL.md` and navigate to line 65. The current line reads:

```markdown
surf perplexity "what is quantum computing"            # Default: Claude Sonnet 4.6 Thinking
```

Replace it with:

```markdown
surf perplexity "what is quantum computing"            # Default: pplx_pro_upgraded (router)
```

- [ ] **Step 3: Update the model table row at line 77**

Open `skills/surf/SKILL.md` and navigate to line 77. The current line is in the "Top Pro thinking picks" markdown table and reads:

```markdown
| `claude46sonnetthinking` (default) | Best format compliance |
```

Replace it with:

```markdown
| `pplx_pro_upgraded` (default) | Perplexity auto-routes per query |
```

- [ ] **Step 4: Update the tips-section line at line 588**

Open `skills/surf/SKILL.md` and navigate to line 588. The current line is in the numbered tips list and reads:

```markdown
15. **Perplexity default = Claude Sonnet 4.6 Thinking** - Picked for format compliance; override with `--model <id>` from `/rest/models/config`. Perplexity's "Thinking" toggle is the `reasoning_model` field, not a URL flag — pass that id to `?model=...`
```

Replace it with:

```markdown
15. **Perplexity default = pplx_pro_upgraded** (auto-router; override with `--model <id>` from `/rest/models/config`). Perplexity's "Thinking" toggle is the `reasoning_model` field, not a URL flag — pass that id to `?model=...`
```

- [ ] **Step 5: Search for any remaining stale references**

Run:
```bash
grep -n "claude46sonnetthinking" skills/surf/SKILL.md
grep -n "Claude Sonnet 4.6 Thinking" skills/surf/SKILL.md
```

Expected: no matches. If any line is still present, it was missed in steps 1-4. Identify the line, fix it, and re-run the search.

Also run:
```bash
grep -rn "claude46sonnetthinking" native/ skills/ docs/superpowers/
```

Expected: 0 hits in `native/` and `skills/`. The historical spec at `docs/superpowers/specs/2026-06-12-ai-provider-stability-test-design.md` may still mention it — that is intentional (historical artifact, do not change).

- [ ] **Step 6: Review the diff**

Run: `git diff skills/surf/SKILL.md`
Expected: 4 line changes. Each line in the diff should be one of the 4 from steps 1-4. No other lines touched.

- [ ] **Step 7: Commit**

```bash
git add skills/surf/SKILL.md
git commit -m "docs(perplexity): update skill doc for pplx_pro_upgraded default"
```

---

## Task 3: Live verification — PONG smoke + override regression

**Files:** none modified in this task. This task is verification only.

**Interfaces:**
- Consumes: the two committed changes from Tasks 1-2
- Produces: empirical evidence that the new default works end-to-end and the `--model` override path still works

**Prerequisites:**
- Native host installed: `npm run install:native -- --id lhleggnadbemlcmebhibmncbkchdbbod` (or already installed)
- Chrome running with the extension loaded (or Edge)
- Logged into perplexity.ai in that browser session
- The socket exists at `/tmp/surf.sock` (or platform equivalent)

If any prerequisite is missing, the PONG test will fail with "Done" or empty — that is the operational signal that the new default was rejected by Perplexity (R1 from the spec). If verification fails, see the "On Failure" section at the end of this task.

- [ ] **Step 1: Verify `--help` shows the new default**

Run: `surf perplexity --help`
Expected: command description shows `(default: pplx_pro_upgraded router)`, the `--model` help text starts with `Model id. Default: pplx_pro_upgraded (auto-router)`, and the first example says `Default model (pplx_pro_upgraded router)`.

If any of these 3 strings is missing, the help-text edits in Task 1 were not applied correctly. Re-check `native/cli.cjs:435, 441-443, 452`.

- [ ] **Step 2: PONG smoke test (primary verification)**

Run: `surf perplexity "Reply with the single word PONG and nothing else"`
Expected:
- Output: `PONG\n` followed by a stderr line like `[search | pplx_pro_upgraded | X.Xs]`
- URL printed on stderr: should contain `model=pplx_pro_upgraded` in the hash fragment
- Total time: < 60s for a PONG reply
- Exit code: 0

If output is empty, returns "Done", times out, or shows a Perplexity error page, the new model id was rejected (R1). See "On Failure" below.

- [ ] **Step 3: Override regression test**

Run: `surf perplexity "Reply with the single word PONG and nothing else" --model claude46sonnetthinking`
Expected:
- Output: `PONG\n` followed by `[search | claude46sonnetthinking | X.Xs]`
- Exit code: 0

This proves the `--model` override path still works and the previous default is still reachable. If this fails with a different error than the PONG smoke failure, the override path is broken (regression beyond the spec's scope — investigate before continuing).

- [ ] **Step 4: AI provider stability suite (optional, longer)**

Run: `npm run test:ai`
Expected: PONG smoke passes for all 7 providers. The Perplexity row in the report should show `pplx_pro_upgraded` (not `claude46sonnetthinking`). If the Perplexity row fails with kind=`selector` / `complete-timeout` / `error`, see the "On Failure" section. Transient failures (`login-required` / `rate-limit` / `network`) are not regressions.

This step is optional because it takes ~10 minutes. Recommended but not blocking. Skip if time-constrained or if the host is not in a state to run the full sweep.

- [ ] **Step 5: Final report**

Report to the user:
- Number of commits: 2 (one per task)
- Verification results from steps 1-3 (and 4 if run)
- Any unexpected diffs
- Any failures and the "On Failure" actions taken

---

## On Failure

If the PONG smoke test (Task 3, Step 2) fails with empty/`Done`/timeout:

1. **Check the URL** — run a fresh PONG test and inspect the URL printed on stderr. It should look like `https://www.perplexity.ai/#?q=...&model=pplx_pro_upgraded`. If `model=pplx_pro_upgraded` is missing, the constant did not flow end-to-end. Re-check `native/host.cjs:695` and the build artifacts (the compiled `native/host.cjs` is what runs; a stale `dist/` from before the edit will not reflect the change).
2. **Test the id directly in a browser** — manually navigate to `https://www.perplexity.ai/#?q=Reply+with+the+single+word+PONG+and+nothing+else&model=pplx_pro_upgraded` in a logged-in Chrome. If Perplexity shows an error or silently ignores the model, the id is invalid. **Revert** by reverting all 3 commits and re-investigating.
3. **Check for rate-limiting** — Perplexity Pro has per-hour query limits. Wait 10-15 minutes and retry. The failure mode is a rate-limit page in the response, not a silent no-op.

If the override regression test (Task 3, Step 3) fails but the PONG smoke test passed: the override path has a separate bug. This is out of scope — revert the override test's expectation in the plan (mark Step 3 as "infrastructure issue, not a regression") and open a follow-up. Do not "fix" the override path under this spec's scope.

If `npm run check` or `npm run lint` fails: a syntax error was introduced. Run `git diff` to find the offending line, fix it, and re-run the failing check before committing.

---

## Self-Review

1. **Spec coverage** — every change in `docs/superpowers/specs/2026-06-19-perplexity-default-model-design.md` maps to a step:
   - Spec "Files to Change §1 host.cjs" → Task 1 Steps 2 (constant + comment)
   - Spec "Files to Change §2 cli.cjs" → Task 1 Steps 3-5 (desc, help text, example)
   - Spec "Files to Change §3 SKILL.md" → Task 2 Steps 1-4 (4 mentions)
   - Spec "What Is NOT Changing" → reflected in Global Constraints + Task 1's "Interfaces"
   - Spec "Verification" → Task 3 Steps 1-4
   - Spec "Risks R1-R4" → R1-R3 are caught by Task 3 Step 2; R4 is verified by Task 1 Step 8's `git diff` and Task 2 Step 5's `grep`
2. **Placeholder scan** — no TBD, no "implement later", no "similar to Task N" cross-references. Every step has the actual content (file path, code block, command, expected output).
3. **Type consistency** — the string `"pplx_pro_upgraded"` is the single source of truth: defined in `host.cjs:695` (Task 1 Step 2), referenced in cli.cjs help text (Task 1 Step 4) and SKILL.md (Task 2 Step 3 table row). No naming drift.

No fixes needed.
