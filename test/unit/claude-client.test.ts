import { describe, expect, it, vi } from "vitest";

// CommonJS import via require pattern used in test/unit/chatgpt-client.test.ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const claudeClient = require("../../native/claude-client.cjs");
const { query, hasRequiredCookies, SELECTORS, CLAUDE_URL } = claudeClient;

describe("claude-client SELECTORS", () => {
  it("promptTextarea targets the contenteditable div", () => {
    expect(SELECTORS.promptTextarea).toBe('div[contenteditable="true"][role="textbox"]');
  });

  it("sendButton is removed (Enter-only send path)", () => {
    expect(SELECTORS).not.toHaveProperty("sendButton");
  });

  it("exports CLAUDE_URL pointing at claude.ai", () => {
    expect(CLAUDE_URL).toBe("https://claude.ai/");
  });
});

describe("claude-client hasRequiredCookies", () => {
  it("accepts a sessionKey cookie", () => {
    expect(hasRequiredCookies([{ name: "sessionKey", value: "abc123" }])).toBe(true);
  });

  it("accepts cookies whose name starts with session", () => {
    expect(hasRequiredCookies([{ name: "session-key", value: "xyz789" }])).toBe(true);
    expect(hasRequiredCookies([{ name: "sessionFoo", value: "f" }])).toBe(true);
  });

  it("rejects Anthropic API cookies (anthropic-device-id, ARID)", () => {
    expect(hasRequiredCookies([{ name: "anthropic-device-id", value: "x" }])).toBe(false);
    expect(hasRequiredCookies([{ name: "ARID", value: "y" }])).toBe(false);
  });

  it("rejects when cookies is null or empty", () => {
    expect(hasRequiredCookies(null)).toBe(false);
    expect(hasRequiredCookies([])).toBe(false);
    expect(hasRequiredCookies(undefined)).toBe(false);
  });

  it("rejects cookies with empty values", () => {
    expect(hasRequiredCookies([{ name: "sessionKey", value: "" }])).toBe(false);
  });
});

describe("claude-client query() error paths", () => {
  it("rejects with login-required error when cookies are missing", async () => {
    const getCookies = async () => ({ cookies: [] });
    const createTab = vi.fn();
    const closeTab = vi.fn();
    const cdpEvaluate = vi.fn();
    const cdpCommand = vi.fn();
    const log = vi.fn();

    await expect(
      query({
        prompt: "hi",
        getCookies,
        createTab,
        closeTab,
        cdpEvaluate,
        cdpCommand,
        log,
      }),
    ).rejects.toThrow(/login required/i);

    // Login fail should never create a tab
    expect(createTab).not.toHaveBeenCalled();
  });

  it("rejects when createTab fails to return a tabId", async () => {
    const getCookies = async () => ({
      cookies: [{ name: "sessionKey", value: "abc" }],
    });
    const createTab = vi.fn(async () => ({})); // no tabId
    const closeTab = vi.fn();
    const cdpEvaluate = vi.fn();
    const cdpCommand = vi.fn();
    const log = vi.fn();

    await expect(
      query({
        prompt: "hi",
        getCookies,
        createTab,
        closeTab,
        cdpEvaluate,
        cdpCommand,
        log,
      }),
    ).rejects.toThrow(/Failed to create Claude\.ai tab/i);

    expect(createTab).toHaveBeenCalledTimes(1);
    // No tab to close, so closeTab should not be called
    expect(closeTab).not.toHaveBeenCalled();
  });
});
