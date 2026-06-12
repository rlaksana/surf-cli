"use strict";

const { describe, it, mock, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

describe("ai-provider-smoke runner", () => {
  let tmpDir;
  let originalSpawn;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-smoke-test-"));
    originalCwd = process.cwd();
    process.chdir("E:\\surf-cli"); // mock surf cli path
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalSpawn) {
      const cp = require("node:child_process");
      cp.spawn = originalSpawn;
    }
  });

  it("returns exit 0 when all 7 providers pass", async () => {
    mockSurfResponses({
      chatgpt: { stdout: "PONG\n", exitCode: 0 },
      gemini: { stdout: "PONG\n", exitCode: 0 },
      claude: { stdout: "PONG\n", exitCode: 0 },
      perplexity: { stdout: "PONG\n", exitCode: 0 },
      grok: { stdout: "PONG\n", exitCode: 0 },
      aistudio: { stdout: "PONG\n", exitCode: 0 },
      aimode: { stdout: "PONG\n", exitCode: 0 },
    });

    const { runSmokeTest } = require("./ai-provider-smoke.cjs");
    const result = await runSmokeTest({
      reportDir: tmpDir,
      captureOnFailure: false,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.pass, 7);
    assert.equal(result.summary.fail, 0);

    // Report should be written
    const reportPath = path.join(tmpDir, "report.json");
    assert.ok(fs.existsSync(reportPath));
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.summary.total, 7);
    assert.equal(report.results.length, 7);
  });

  it("returns exit 1 when any provider fails", async () => {
    mockSurfResponses({
      chatgpt: { stdout: "PONG\n", exitCode: 0 },
      gemini: { stdout: "", stderr: "rate limited\n", exitCode: 1 },
      claude: { stdout: "Done\n", exitCode: 0 }, // selector failure
      perplexity: { stdout: "PONG\n", exitCode: 0 },
      grok: { stdout: "", stderr: "login required\n", exitCode: 1 },
      aistudio: { stdout: "PONG\n", exitCode: 0 },
      aimode: { stdout: "PONG\n", exitCode: 0 },
    });

    const { runSmokeTest } = require("./ai-provider-smoke.cjs");
    const result = await runSmokeTest({
      reportDir: tmpDir,
      captureOnFailure: false,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.pass, 4);
    assert.equal(result.summary.fail, 3);
    assert.equal(result.results[1].failureKind, "rate-limit");
    assert.equal(result.results[2].failureKind, "selector");
    assert.equal(result.results[4].failureKind, "login-required");
  });
});

// Helper: mock child_process.spawn for `surf` invocations
function mockSurfResponses(responses) {
  const cp = require("node:child_process");
  const original = cp.spawn;
  cp.spawn = mock.fn((cmd, args) => {
    const { EventEmitter } = require("node:events");
    const provider = args[0];
    const resp = responses[provider] || { stdout: "", stderr: "", exitCode: 0 };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => {
      if (resp.stdout) child.stdout.emit("data", Buffer.from(resp.stdout));
      if (resp.stderr) child.stderr.emit("data", Buffer.from(resp.stderr));
      child.emit("close", resp.exitCode);
    });
    return child;
  });
}
