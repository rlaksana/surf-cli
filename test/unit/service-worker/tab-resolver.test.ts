import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTabForCommand } from "../../../src/service-worker/tab-resolver";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

let chrome: ReturnType<typeof createChromeMock>;

beforeEach(() => {
  resetChromeMock();
  chrome = createChromeMock();
  (globalThis as any).chrome = chrome;
});

afterEach(() => {
  resetChromeMock();
});

describe("resolveTabForCommand — explicit tabId", () => {
  it("uses explicit tabId when provided and tab exists", async () => {
    chrome.tabs.get.mockResolvedValue({ id: 42 });
    const result = await resolveTabForCommand({ type: "READ_PAGE", tabId: 42 }, 42);
    expect(result).toEqual({
      tabId: 42,
      autoCreated: false,
      closeAfter: false,
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it("rejects invalid explicit tabId", async () => {
    chrome.tabs.get.mockRejectedValue(new Error("No tab"));
    await expect(resolveTabForCommand({ type: "READ_PAGE", tabId: 999 }, 999)).rejects.toThrow(
      /Invalid tab ID: 999/,
    );
  });

  it("uses explicit tabId for DIALOG_ commands without re-validating against chrome.tabs.get", async () => {
    // chrome.tabs.get rejects (mimics a dialog running in a tab that's already gone),
    // but DIALOG_ commands should still trust the provided tabId and not throw.
    chrome.tabs.get.mockRejectedValue(new Error("No tab"));
    const result = await resolveTabForCommand({ type: "DIALOG_ACCEPT", tabId: 7 }, 7);
    expect(result.tabId).toBe(7);
    expect(result.autoCreated).toBe(false);
  });
});

describe("resolveTabForCommand — inspect bucket (default = active tab)", () => {
  it("uses user's active tab when no flags are set", async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 7, url: "https://docs.example.com" }] as any);
    const result = await resolveTabForCommand({ type: "READ_PAGE" }, undefined);
    expect(result).toEqual({
      tabId: 7,
      autoCreated: false,
      closeAfter: false,
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("does not hijack user's chrome:// tabs when falling back through window queries", async () => {
    chrome.tabs.query
      .mockResolvedValueOnce([]) // lastFocusedWindow
      .mockResolvedValueOnce([{ id: 5, url: "chrome://settings" }]) // currentWindow
      .mockResolvedValueOnce([{ id: 5, url: "chrome://settings" }]); // active global
    await expect(resolveTabForCommand({ type: "EXECUTE_SCREENSHOT" }, undefined)).rejects.toThrow(
      /No active tab/,
    );
  });

  it("throws a helpful error when no usable active tab exists", async () => {
    chrome.tabs.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 5, url: "chrome://settings" }]);
    await expect(resolveTabForCommand({ type: "LOCATE_ROLE" }, undefined)).rejects.toThrow(
      /No active tab found/,
    );
  });

  it("click on user's active tab does NOT auto-create a background tab", async () => {
    chrome.tabs.query.mockResolvedValue([
      { id: 11, url: "https://app.example.com/dashboard" },
    ] as any);
    const result = await resolveTabForCommand(
      { type: "FIND_AND_TYPE", selector: "input" } as any,
      undefined,
    );
    expect(result.tabId).toBe(11);
    expect(result.autoCreated).toBe(false);
  });
});

describe("resolveTabForCommand — browse bucket (auto background tab)", () => {
  it("navigate auto-creates a background tab and marks it for closing", async () => {
    chrome.tabs.create.mockResolvedValue({ id: 200 });
    const result = await resolveTabForCommand(
      { type: "EXECUTE_NAVIGATE", url: "https://example.com" },
      undefined,
    );
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "https://example.com",
      active: false,
    });
    expect(result).toEqual({
      tabId: 200,
      autoCreated: true,
      closeAfter: true,
      hint: expect.stringContaining("background tab"),
    });
  });

  it("back/forward auto-create a background tab", async () => {
    chrome.tabs.create.mockResolvedValue({ id: 201 });
    const result = await resolveTabForCommand({ type: "EXECUTE_BACK" }, undefined);
    expect(chrome.tabs.create).toHaveBeenCalled();
    expect(result.autoCreated).toBe(true);
    expect(result.closeAfter).toBe(true);
  });

  it("--keep-tab opens a background tab but does not mark it for closing", async () => {
    chrome.tabs.create.mockResolvedValue({ id: 202 });
    const result = await resolveTabForCommand(
      { type: "EXECUTE_NAVIGATE", url: "https://example.com", _keepTab: true },
      undefined,
    );
    expect(result.tabId).toBe(202);
    expect(result.autoCreated).toBe(true);
    expect(result.closeAfter).toBe(false);
    expect(result.hint).toContain("id 202");
  });

  it("falls back to data URL when browse command has no URL", async () => {
    chrome.tabs.create.mockResolvedValue({ id: 203 });
    await resolveTabForCommand(
      { type: "EXECUTE_NAVIGATE" }, // no url
      undefined,
    );
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("data:text/html"),
        active: false,
      }),
    );
  });
});

describe("resolveTabForCommand — --new-tab opt-in for inspect bucket", () => {
  it("forces background-tab mode for inspect commands when --new-tab is set", async () => {
    chrome.tabs.create.mockResolvedValue({ id: 300 });
    const result = await resolveTabForCommand({ type: "READ_PAGE", _newTab: true }, undefined);
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(result.autoCreated).toBe(true);
    expect(result.closeAfter).toBe(true);
    // Critical: the user's active tab is NOT queried when --new-tab is set.
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it("--new-tab + --keep-tab leaves the bg tab open", async () => {
    chrome.tabs.create.mockResolvedValue({ id: 301 });
    const result = await resolveTabForCommand(
      { type: "EXECUTE_SCREENSHOT", _newTab: true, _keepTab: true },
      undefined,
    );
    expect(result.autoCreated).toBe(true);
    expect(result.closeAfter).toBe(false);
  });
});

describe("resolveTabForCommand — windowId path stays scoped", () => {
  it("uses active tab in given window without auto-creating", async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 50, url: "https://myapp.example.com" }] as any);
    const result = await resolveTabForCommand({ type: "READ_PAGE", windowId: 7 }, undefined);
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      active: true,
      windowId: 7,
    });
    expect(result).toEqual({
      tabId: 50,
      autoCreated: false,
      closeAfter: false,
    });
  });

  it("auto-creates in given window when no usable tab exists (avoids user data loss)", async () => {
    chrome.tabs.query.mockResolvedValueOnce([{ id: 60, url: "chrome://newtab" }] as any);
    chrome.tabs.query.mockResolvedValueOnce([{ id: 60, url: "chrome://newtab" }] as any);
    chrome.tabs.create.mockResolvedValue({ id: 61 });
    const result = await resolveTabForCommand({ type: "READ_PAGE", windowId: 7 }, undefined);
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ windowId: 7, active: true }),
    );
    expect(result.autoCreated).toBe(true);
    expect(result.hint).toContain("Auto-created");
  });
});

describe("resolveTabForCommand — unclassified commands (maintenance safety net)", () => {
  it("unclassified command without url arg defaults to INSPECT (does not hijack user tab)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // intentional noop for test
    });
    chrome.tabs.query.mockResolvedValue([
      { id: 11, url: "https://app.example.com/dashboard" },
    ] as any);
    const result = await resolveTabForCommand(
      { type: "FUTURE_COMMAND_NOT_IN_BUCKETS" } as any,
      undefined,
    );
    expect(result.tabId).toBe(11);
    expect(result.autoCreated).toBe(false);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    // Warning surfaces the gap so devs see why fallback fired.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("FUTURE_COMMAND_NOT_IN_BUCKETS"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("INSPECT"));
    warnSpy.mockRestore();
  });

  it("unclassified command WITH url arg escalates to BROWSE (auto-bg tab + close)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // intentional noop for test
    });
    chrome.tabs.create.mockResolvedValue({ id: 400 });
    const result = await resolveTabForCommand(
      { type: "FUTURE_NAVIGATE_LIKE", url: "https://example.com" } as any,
      undefined,
    );
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, url: "https://example.com" }),
    );
    expect(result.tabId).toBe(400);
    expect(result.autoCreated).toBe(true);
    expect(result.closeAfter).toBe(true);
    // Warning includes BROWSE so devs see the routing decision.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("BROWSE"));
    warnSpy.mockRestore();
  });
});
