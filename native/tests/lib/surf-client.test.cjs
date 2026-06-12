"use strict";

const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");

// We mock child_process.spawn BEFORE requiring the module under test.
const cp = require("node:child_process");
const originalSpawn = cp.spawn;

describe("surf-client.runProvider()", () => {
  it("invokes `surf <provider> <prompt>` with a 90s timeout", async () => {
    let capturedArgs = null;
    cp.spawn = mock.fn((cmd, args) => {
      capturedArgs = { cmd, args };
      // Fake a successful child process
      const { EventEmitter } = require("node:events");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit("data", Buffer.from("PONG\n"));
        child.stderr.emit("data", Buffer.from("[chatgpt | 12.4s]\n"));
        child.emit("close", 0);
      });
      return child;
    });

    const { runProvider } = require("./surf-client.cjs");
    const result = await runProvider({
      provider: "chatgpt",
      prompt: "PONG",
      timeoutMs: 90000,
    });

    // Verify spawn was called with the right command
    assert.equal(capturedArgs.cmd, "surf");
    assert.deepEqual(capturedArgs.args[0], "chatgpt");
    assert.deepEqual(capturedArgs.args[1], "PONG");

    // Verify result shape
    assert.equal(result.status, null);  // not classified here
    assert.equal(result.stdout, "PONG\n");
    assert.equal(result.stderr, "[chatgpt | 12.4s]\n");
    assert.equal(result.exitCode, 0);
    assert.equal(result.responseLength, 4);  // trimmed "PONG" is 4 chars

    cp.spawn = originalSpawn;
  });

  it("returns empty response when stdout is whitespace only", async () => {
    const { EventEmitter } = require("node:events");
    cp.spawn = mock.fn(() => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit("data", Buffer.from("Done\n"));
        child.emit("close", 0);
      });
      return child;
    });

    const { runProvider } = require("./surf-client.cjs");
    const result = await runProvider({
      provider: "gemini",
      prompt: "PONG",
      timeoutMs: 90000,
    });

    // "Done" is a real CLI output (gemini returns "Done" when no response)
    assert.equal(result.responseLength, 0);  // not PONG content
    assert.equal(result.exitCode, 0);

    cp.spawn = originalSpawn;
  });

  it("returns failure when spawn itself errors (e.g. surf not installed)", async () => {
    const { EventEmitter } = require("node:events");
    cp.spawn = mock.fn(() => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.emit("error", new Error("spawn surf ENOENT"));
      });
      return child;
    });

    const { runProvider } = require("./surf-client.cjs");
    const result = await runProvider({
      provider: "chatgpt",
      prompt: "PONG",
      timeoutMs: 90000,
    });

    assert.equal(result.exitCode, -1);
    assert.match(result.stderr, /ENOENT/);

    cp.spawn = originalSpawn;
  });
});
