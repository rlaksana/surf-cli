import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

// Mock the native port-manager to prevent initNativeMessaging side effects
vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

type SurfTabResult = { tab: chrome.tabs.Tab; created: boolean } | null;

let getOrCreateSurfTab: () => Promise<SurfTabResult>;

beforeEach(async () => {
  // Fresh chrome mock + fresh module so the in-process surfTabIdCache
  // cannot leak between tests.
  resetChromeMock();
  (globalThis as any).chrome = createChromeMock();
  vi.resetModules();
  const mod = await import("../../../src/service-worker/index");
  getOrCreateSurfTab = mod.getOrCreateSurfTab;
});

afterEach(() => {
  resetChromeMock();
});

describe("getOrCreateSurfTab (background-only policy)", () => {
  it("creates a background tab in the focused window and persists the id", async () => {
    const chrome = (globalThis as any).chrome;
    chrome.tabs.query.mockResolvedValue([{ id: 10, windowId: 1, active: true }]);
    chrome.tabs.create.mockResolvedValue({ id: 77 });
    chrome.storage.session.get.mockResolvedValue({});

    const result = await getOrCreateSurfTab();

    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ windowId: 1, active: false }),
    );
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ surfTabId: 77 });
    expect(result).not.toBeNull();
    expect(result?.created).toBe(true);
    expect(result?.tab.id).toBe(77);
  });

  it("reuses the stored surf tab without creating a new one", async () => {
    const chrome = (globalThis as any).chrome;
    chrome.storage.session.get.mockResolvedValue({ surfTabId: 42 });
    chrome.tabs.get.mockResolvedValue({ id: 42 });

    const result = await getOrCreateSurfTab();

    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.created).toBe(false);
    expect(result?.tab.id).toBe(42);
  });

  it("recreates the tab when the stored id is stale (closed manually)", async () => {
    const chrome = (globalThis as any).chrome;
    chrome.storage.session.get.mockResolvedValue({ surfTabId: 99 });
    chrome.tabs.get.mockRejectedValue(new Error("Tab not found"));
    chrome.tabs.query.mockResolvedValue([{ id: 10, windowId: 1, active: true }]);
    chrome.tabs.create.mockResolvedValue({ id: 100 });

    const result = await getOrCreateSurfTab();

    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ surfTabId: 100 });
    expect(result).not.toBeNull();
    expect(result?.created).toBe(true);
    expect(result?.tab.id).toBe(100);
  });

  it("creates the tab backgrounded even when no focused window exists", async () => {
    const chrome = (globalThis as any).chrome;
    chrome.tabs.query.mockResolvedValue([]);
    chrome.tabs.create.mockResolvedValue({ id: 50 });

    const result = await getOrCreateSurfTab();

    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    // No windowId injected when no focused window is available
    const call = chrome.tabs.create.mock.calls[0][0];
    expect(call).not.toHaveProperty("windowId");
    expect(result?.created).toBe(true);
  });
});
