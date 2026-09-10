"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { classify } = require("./result-classifier.cjs");

describe("classify()", () => {
  it("returns PASS for non-empty response within timeout", () => {
    const result = classify({
      stdout: "PONG\n",
      stderr: "[chatgpt | 12.4s]\n",
      exitCode: 0,
      tookMs: 12400,
      responseLength: 4,
    });
    assert.equal(result.status, "PASS");
    assert.equal(result.failureKind, null);
  });

  it("returns FAIL with kind=login-required when stderr mentions login", () => {
    const result = classify({
      stdout: "",
      stderr: "Error: ChatGPT login required. Found 0 cookies\n",
      exitCode: 1,
      tookMs: 350,
      responseLength: 0,
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.failureKind, "login-required");
  });

  it("returns FAIL with kind=login-required when stdout contains grok login wall", () => {
    // Grok returns the login modal text in stdout when not signed in
    // (not in stderr, so we must scan combined). The chat wall
    // includes "Connect your 𝕏 account".
    const result = classify({
      stdout: "Imagine\nWhat do you want to know?\nConnect your 𝕏 account\nUnlock early features\n",
      stderr: "",
      exitCode: 0,
      tookMs: 8000,
      responseLength: 65,  // non-empty
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.failureKind, "login-required");
  });

  it("returns FAIL with kind=rate-limit when stdout/stderr contains 429", () => {
    const result = classify({
      stdout: "",
      stderr: "Error: 429 Too Many Requests. Try again in 60s.\n",
      exitCode: 1,
      tookMs: 1200,
      responseLength: 0,
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.failureKind, "rate-limit");
  });

  it("returns FAIL with kind=network when stderr contains fetch failed", () => {
    const result = classify({
      stdout: "",
      stderr: "Error: fetch failed (ENOTFOUND)\n",
      exitCode: 1,
      tookMs: 5000,
      responseLength: 0,
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.failureKind, "network");
  });

  it("returns FAIL with kind=complete-timeout when tookMs >= 90s and empty", () => {
    const result = classify({
      stdout: "",
      stderr: "",
      exitCode: 124,
      tookMs: 90000,
      responseLength: 0,
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.failureKind, "complete-timeout");
  });

  it("returns FAIL with kind=selector when response is empty but exit 0", () => {
    const result = classify({
      stdout: "Done\n",
      stderr: "[gemini | 22.0s]\n",
      exitCode: 0,
      tookMs: 22000,
      responseLength: 0,
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.failureKind, "selector");
  });

  it("returns FAIL with kind=error for other non-zero exits", () => {
    const result = classify({
      stdout: "",
      stderr: "Some unexpected error: foo bar baz\n",
      exitCode: 2,
      tookMs: 500,
      responseLength: 0,
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.failureKind, "error");
  });

  it("returns PASS for non-PONG content if non-empty (lenient mode for paraphrasing models)", () => {
    const result = classify({
      stdout: "Sure! PONG 🎉\n",
      stderr: "[aimode | 3.4s]\n",
      exitCode: 0,
      tookMs: 3400,
      responseLength: 11,
    });
    assert.equal(result.status, "PASS");
    assert.equal(result.failureKind, null);
  });
});
