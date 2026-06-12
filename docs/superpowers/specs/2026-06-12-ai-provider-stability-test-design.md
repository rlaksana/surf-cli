# AI Provider Stability Test — Design

**Date:** 2026-06-12
**Status:** Approved
**Author:** Surf design session

## Problem

Surf-cli's AI provider integrations regress within a day of being fixed. UIs change silently, selectors break, and users (both human and AI agents invoking the skill) get empty responses or "Done" placeholders. The current evidence trail:

- 2026-06-05: Surf-completion-detection sprint fixed 5 of 7 providers
- 2026-06-12: ChatGPT thinking-model completion broke again; force-complete safety net not firing
- Pattern: fix → green for 1 day → regression → user discovers failure in real use → emergency fix

Existing fix protocol in `CLAUDE.md` is **manual**: capture 4 snapshots, diff, propose, edit, test, regression check. This is exactly the workflow that needs to be **automated at the diagnostic stage** so the AI agent can self-heal.

## Goal

A test runner that, when invoked, tells the AI agent (and the human user) **which providers are broken and why**, with enough diagnostic context to fix the break in one cycle. The self-heal itself is performed by the AI agent in conversation, not by the test runner — the test's job is to gather the right evidence.

## Non-Goals

- Fully automated selector patching without human approval
- Continuous monitoring / scheduled runs
- Cross-provider quality comparison
- History / trend tracking (replaced by git log + on-demand reruns)
- Replacing the existing 284 unit tests in `test/unit/`
- Mock-based tests (these are end-to-end against real Chrome sessions)

## Architecture: 3-Stage AI-Driven Test Loop

### Stage 1 — Smoke (always runs)

Run `surf <provider> "PONG"` for each of the 7 providers, sequentially, with 90s timeout per provider. Classify each result as PASS or FAIL with a `failureKind` enum.

```
for provider in [chatgpt, gemini, claude, perplexity, grok, aistudio, aimode]:
    result = runProvider(provider, prompt="Reply with the single word PONG and nothing else", timeout=90s)
    results.push(result)

emitConsoleTable(results)
writeJsonReport(results)
exit(passCount == 7 ? 0 : 1)
```

### Stage 2 — Capture (only on failure)

For each FAIL, open a fresh tab, navigate to the provider, and capture 4 a11y-tree snapshots in sequence, with 5s settle between states:

1. **empty** — provider home / new chat
2. **submitting** — right after `Enter` pressed
3. **streaming** — mid-response, tokens arriving (use polling: capture when text length > 50 chars)
4. **completed** — response fully shown, no more activity (capture when stop button disappears)

These mirror the `CLAUDE.md` "selector recovery guide" protocol exactly. Snapshots saved to `.research/ai-failure-<provider>-<timestamp>/snapshots/{empty,submitting,streaming,completed}.txt`.

Plus: dump last 200 lines of `/tmp/surf/surf-host.log` filtered to that tab ID.

### Stage 3 — AI Diagnosis (in conversation, not in test)

The test produces a JSON report. The AI agent (me, in this conversation) reads the report, classifies each FAIL as selector-drift vs transient (rate-limit, network, login-required), proposes a fix, asks user to approve, applies, re-runs Stage 1.

This is **not** automated CI/CD. This is the human-AI fix loop, where the test's job is to produce actionable diagnostics.

## Test Cases

| # | Provider | Model hint | Pass criteria | failureKind enum |
|---|----------|-----------|---------------|------------------|
| 1 | chatgpt | `--model thinking` | response contains "PONG" (case-insensitive), tookMs < 90s | selector, network, complete-timeout, error |
| 2 | gemini | default | same | same |
| 3 | claude | default | same | same |
| 4 | perplexity | default | same | same |
| 5 | grok | default | same | login-required, selector, network, complete-timeout |
| 6 | aistudio | default | same | rate-limit, selector, network, complete-timeout |
| 7 | aimode | default | same | selector, network, complete-timeout |

**Why "PONG":** Canonical smoke test already documented in `CLAUDE.md` as the regression check. Single-word response is easy to assert non-ambiguously across providers that may paraphrase.

**Why sequential, not parallel:** All providers share one Chrome native host (`\\.\pipe\surf`). Parallel invocations would queue and complicate timing measurement. Sequential is simpler and gives accurate `tookMs` per provider.

**Why 90s timeout:** Thinking models (GPT-5 thinking, Claude extended thinking, Grok thinking) can take 45–60s. 90s is enough headroom for one-off network blip but tight enough to fail fast on real breakage.

## Components

| File | Purpose | LOC est |
|------|---------|---------|
| `native/tests/ai-provider-smoke.cjs` | Main test runner, executes Stage 1 + 2 | ~250 |
| `native/tests/lib/snapshot-capture.cjs` | 4-state a11y tree capture | ~120 |
| `native/tests/lib/result-classifier.cjs` | Classify failureKind from stdout/exit | ~80 |
| `native/tests/lib/surf-client.cjs` | Wraps `surf` CLI invocation with timeout/retry | ~60 |
| `scripts/ai-provider-smoke.sh` | Shell wrapper: `node native/tests/ai-provider-smoke.cjs` | ~10 |

**No new dependencies.** Pure Node 18+ stdlib (child_process, fs, path). Same `require('./chatgpt-client.cjs')` style as the rest of `native/`.

## Output Specification

### Console table (always, to stdout)

```
Provider     Status    Time     Chars  FailureKind
chatgpt      PASS      12.4s    4      -
gemini       PASS      8.1s     4      -
claude       FAIL      90.0s    0      complete-timeout
perplexity   PASS      6.2s     4      -
grok         FAIL      0.3s     0      login-required
aistudio     FAIL      1.1s     0      rate-limit
aimode       PASS      3.4s     4      -

4/7 providers PASS. 3 FAIL. Snapshots: .research/ai-smoke-20260612-085000/
```

### JSON report (always, to file)

`/.research/ai-smoke-<timestamp>/report.json`:

```json
{
  "timestamp": "2026-06-12T08:50:00.000Z",
  "surfVersion": "2.7.2",  // obtained via `surf --version` at test start
  "summary": {
    "total": 7,
    "pass": 4,
    "fail": 3,
    "exitCode": 1
  },
  "results": [
    {
      "provider": "claude",
      "status": "FAIL",
      "tookMs": 90000,
      "responseLength": 0,
      "firstChars": "",
      "failureKind": "complete-timeout",
      "rawStdout": "...",
      "rawStderr": "...",
      "snapshotsDir": ".research/ai-smoke-20260612-085000/claude/",
      "hostLogTail": "/tmp/surf/surf-host.log lines 4500-4700"
    }
  ]
}
```

### Snapshot directory (only on failure)

`/.research/ai-smoke-<timestamp>/<provider>/snapshots/`:

- `empty.txt` — accessibility tree of idle chat
- `submitting.txt` — right after submit
- `streaming.txt` — mid-response
- `completed.txt` — response fully shown
- `host-log-tail.txt` — last 200 lines filtered to this provider's tabId

## failureKind Classification

| Kind | Detected by | Self-heal action |
|------|-------------|------------------|
| `selector` | response is empty AND stdout shows selector match failures OR snapshot's expected selector strings absent | AI diffs snapshot against selectors.cjs, proposes patch |
| `complete-timeout` | tookMs >= timeout AND response is empty | Same as selector (likely selector broke) |
| `network` | stderr contains "fetch failed" / "ENOTFOUND" / "ETIMEDOUT" | Retry once, mark transient if passes |
| `login-required` | stderr contains "login required" or "login check failed" | Skip, do not classify as regression (user-side issue) |
| `rate-limit` | stderr or stdout contains "rate limit" / "429" / "too many requests" | Skip, do not classify as regression (transient) |
| `error` | anything else unexpected | AI reads stdout/stderr to diagnose |

**Why skip login/rate-limit from regression:** These are user-environment issues, not code regressions. Surf can't fix "you're not logged in" or "you've been rate-limited today" automatically.

## Self-Heal Flow (in conversation)

After test exits 1, the AI agent (in this conversation):

1. **Reads** `.research/ai-smoke-<ts>/report.json`
2. **For each FAIL:** reads provider's `snapshots/*.txt` + `host-log-tail.txt`
3. **Classifies** as selector-drift or transient (using the failureKind enum + content inspection)
4. **Diffs** observed DOM against `native/clients/<provider>/selectors.cjs`:
   - `grep -F "data-testid" completed.txt` → list of test IDs in DOM
   - `grep -F "aria-label" completed.txt` → list of aria-labels in DOM
   - Compare with selector chain in `selectors.cjs`
5. **Proposes** new selector text + shows user the diff
6. **Awaits approval** (does not auto-apply)
7. **Applies** the fix
8. **Re-runs** the test (`node native/tests/ai-provider-smoke.cjs`)
9. **Loops** until all green

## Verification Criteria

The implementation is done when:

- [ ] `node native/tests/ai-provider-smoke.cjs` runs all 7 providers sequentially
- [ ] Total wall-clock ≤ 10 min (sum of 7 × 90s + overhead)
- [ ] Each provider result has: status, tookMs, responseLength, firstChars, failureKind
- [ ] Console table renders with monospace alignment for all 7 rows
- [ ] JSON report is valid JSON, parseable by `JSON.parse`
- [ ] On any FAIL: 4 snapshot files + host-log-tail written to `.research/ai-smoke-<ts>/<provider>/`
- [ ] Exit code 0 if 7/7 pass, 1 otherwise
- [ ] No state pollution: each run uses a fresh tab (closeTab on failure path)
- [ ] Test re-runnable: running twice in a row produces equivalent results (modulo network flakiness)
- [ ] Existing 284 unit tests still pass (no regressions in shared modules)

## Risk & Mitigations

| Risk | Mitigation |
|------|-----------|
| Test itself becomes flaky (network blip → false FAIL) | failureKind enum classifies network/rate-limit distinctly; AI agent learns to retry transient cases |
| Snapshot capture is slow (4 states × 5s settle = 20s per FAIL) | Only on FAIL; happy path stays under 10 min total |
| Cloudflare / anti-bot challenges block the test | Already in `isCloudflareBlocked` for chatgpt; same pattern for others — classify as `error`, capture snapshot for diagnosis |
| Provider's UI changed → selector.cjs has 5+ stale selectors → fix is non-obvious | AI agent has full snapshot context; user approves fix before apply; don't auto-apply |
| Test runs in CI without Chrome | Future work: detect headless env, skip with informative message. Not in v1 scope. |
| Host log gets too large to filter quickly | Filter by tabId from the test's createTab response; cap tail at 200 lines |

## Out of Scope (deferred to v2+)

- Run-on-CI / GitHub Actions integration
- Slack/Discord notification on regression
- Parallel provider execution (when host supports it)
- Quality assertions beyond PONG
- Auto-apply of trivial selector fixes (after ≥2 consecutive failures, with user approval)
- Mock-based tests for offline CI
- Trend analysis across runs (use git log + on-demand reruns instead)

## Files to Create

1. `native/tests/ai-provider-smoke.cjs` (main runner)
2. `native/tests/lib/snapshot-capture.cjs` (4-state capture)
3. `native/tests/lib/result-classifier.cjs` (failureKind enum)
4. `native/tests/lib/surf-client.cjs` (CLI wrapper)
5. `scripts/ai-provider-smoke.sh` (shell wrapper)
6. `package.json` script entry: `"test:ai": "node native/tests/ai-provider-smoke.cjs"`
7. `.research/ai-smoke-` baseline: no initial baseline — first run creates report

## Files to Modify

- `package.json` — add `"test:ai"` script
- (no other modifications — fully additive)
