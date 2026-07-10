/**
 * Tab resolver — decides which Chrome tab a command should run on.
 *
 * Bug context: When a tool request arrives from the CLI without --tab-id, the
 * service worker previously fell back to the user's currently-active tab
 * (`chrome.tabs.query({ active: true, lastFocusedWindow: true })`), hijacking
 * whatever the user was working on. AI providers (chatgpt/claude/etc.) avoid
 * this by always opening their own background tab via `*_NEW_TAB`/`*_CLOSE_TAB`.
 *
 * This module extends that same pattern to the rest of the browse commands,
 * but only where it makes sense:
 *
 *   BROWSE bucket (navigate, go, back, forward, etc.):
 *     - No tabId  → auto-create a background tab → run command → close it.
 *     - --keep-tab → leave the background tab open for inspection.
 *     - tabId given → use it (no auto-create, no close).
 *
 *   INSPECT bucket (page.read, click, type, screenshot, locate.*, etc.):
 *     - No tabId → use the user's active tab (preserves current behavior).
 *     - --new-tab → force background-tab mode for isolation.
 *     - tabId given → use it.
 *
 *   AI_* / *_NEW_TAB / *_CLOSE_TAB / tabs list / window ops / etc.:
 *     Already in COMMANDS_WITHOUT_TAB — the host short-circuits before this
 *     resolver runs.
 */

export type ResolvedTab = {
  tabId: number;
  autoCreated: boolean;
  closeAfter: boolean;
  hint?: string;
};

/**
 * Commands whose semantic is "navigate somewhere new" — for these, opening a
 * background tab is safer and matches what AI providers already do.
 */
const BROWSE_COMMANDS = new Set<string>([
  "EXECUTE_NAVIGATE",
  "EXECUTE_BACK",
  "EXECUTE_FORWARD",
  "TAB_RELOAD", // reloads whatever tab we open — user intent is "reload in a fresh context"
  "TABS_CREATE",
  "BATCH_EXECUTE", // batches are typically "do this whole thing" → bg tab
  "DO_WORKFLOW", // if/when do surfaces as a single message
]);

/**
 * Commands whose semantic is "inspect / interact with the user's current
 * view". These keep the existing active-tab fallback so `page.read`,
 * `screenshot`, `click`, etc. continue to mean "what the user sees".
 */
const INSPECT_COMMANDS = new Set<string>([
  "READ_PAGE",
  "GET_PAGE_TEXT",
  "PAGE_STATE",
  "EXECUTE_SCREENSHOT",
  "LOCATE_ROLE",
  "LOCATE_TEXT",
  "EXECUTE_JAVASCRIPT",
  "EVAL_IN_PAGE",
  "FIND_AND_TYPE",
  "AUTOCOMPLETE_SELECT",
  "SET_INPUT_VALUE",
  "SMART_TYPE",
  "SCROLL_TO_POSITION",
  "GET_SCROLL_INFO",
  "SCROLL_TO_ELEMENT",
  "SCROLL_TOP",
  "SCROLL_BOTTOM",
  "WAIT_FOR_ELEMENT",
  "WAIT_FOR_URL",
  "WAIT_FOR_NETWORK_IDLE",
  "WAIT_FOR_DOM_STABLE",
  "WAIT_FOR_LOAD",
  "GET_FRAMES",
  "FRAME_SWITCH",
  "FRAME_MAIN",
  "EVALUATE_IN_FRAME",
  "CLOSE_DIALOGS",
  "DIALOG_DISMISS",
  "DIALOG_ACCEPT",
  "DIALOG_INFO",
  "EMULATE_NETWORK",
  "EMULATE_CPU",
  "EMULATE_GEO",
  "EMULATE_VIEWPORT",
  "EMULATE_TOUCH",
  "EMULATE_DEVICE",
  "FORM_FILL",
  "FORM_INPUT",
  "SELECT_OPTION",
  "LOCATE_LABEL",
  "UPLOAD_FILE",
  "UPLOAD_IMAGE",
  "READ_CONSOLE_MESSAGES",
  "READ_NETWORK_REQUESTS",
  "GET_NETWORK_ENTRY",
  "GET_RESPONSE_BODY",
  "GET_NETWORK_ORIGINS",
  "CLEAR_NETWORK_REQUESTS",
  "GET_NETWORK_STATS",
  "EXPORT_NETWORK_REQUESTS",
  "GET_NETWORK_PATHS",
  "PERF_AUDIT",
  "ANIMATE_AUDIT",
  "PERF_START",
  "PERF_STOP",
  "PERF_METRICS",
  "RESIZE_WINDOW",
  "ZOOM_SET",
  "ZOOM_RESET",
  "ZOOM_GET",
  "ELEMENT_STYLES",
  "AI_ANALYZE",
  "HEALTH_CHECK_URL",
  "SMOKE_TEST",
  "GET_COOKIES",
  "SET_COOKIE",
  "DELETE_COOKIES",
  "COOKIE_LIST",
  "COOKIE_GET",
  "COOKIE_SET",
  "COOKIE_REMOVE",
]);

const DIALOG_PREFIX = "DIALOG_";

function isRestrictedUrl(url?: string): boolean {
  return (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url === "about:blank"
  );
}

/**
 * Decide which bucket a message falls into.
 * BROWSE → auto-create bg tab. INSPECT → use active tab.
 * Returns null if neither matches (caller should fall through to existing
 * windowId-scoped fallback for unknown commands).
 */
function classifyCommand(type: string | undefined): "browse" | "inspect" | null {
  if (!type) return null;
  if (BROWSE_COMMANDS.has(type)) return "browse";
  if (INSPECT_COMMANDS.has(type)) return "inspect";
  return null;
}

/**
 * Resolve the effective bucket for routing, including the unclassified fallback.
 * Unclassified commands default to INSPECT (preserve current behavior — don't
 * hijack user tab) UNLESS the command carries a `url` arg, in which case it's
 * almost certainly a navigation intent and we route to BROWSE.
 *
 * Returns the bucket plus a `warnReason` if a fallback was applied (so the
 * caller can log a console.warn explaining what happened).
 */
function resolveBucket(
  type: string | undefined,
  hasUrlArg: boolean,
  wantsNewTab: boolean,
): { bucket: "browse" | "inspect"; warnReason: string | null } {
  const classified = classifyCommand(type);
  if (classified) {
    return { bucket: classified, warnReason: null };
  }
  // Unclassified. Default to INSPECT (safer — does not steal user's tab).
  // URL-arg heuristic: an unclassified command carrying a URL is almost
  // certainly a navigation intent. Escalate to BROWSE.
  if (hasUrlArg) {
    return {
      bucket: "browse",
      warnReason: `unclassified command "${type}" with url arg → defaulting to BROWSE`,
    };
  }
  return {
    bucket: "inspect",
    warnReason: wantsNewTab
      ? `unclassified command "${type}" with --new-tab → defaulting to INSPECT (treat as inspect; --new-tab may not have intended effect)`
      : `unclassified command "${type}" → defaulting to INSPECT (preserves current behavior)`,
  };
}

/**
 * Resolve which tab a command should run on.
 *
 * @param msg - Tool request from native messaging (may include tabId, windowId,
 *              _newTab, _keepTab flags).
 * @param explicitTabId - tabId parsed at the host entry (numeric, undefined if absent).
 * @returns ResolvedTab — caller must `chrome.tabs.remove(tabId)` afterwards iff
 *          `closeAfter` is true.
 */
export async function resolveTabForCommand(
  msg: { type?: string; tabId?: number | string; windowId?: number | string; url?: string; _newTab?: boolean; _keepTab?: boolean },
  explicitTabId: number | undefined,
): Promise<ResolvedTab> {
  const isDialogCommand = msg.type?.startsWith(DIALOG_PREFIX) ?? false;
  const windowId =
    msg.windowId !== undefined && !Number.isNaN(Number(msg.windowId))
      ? Number(msg.windowId)
      : undefined;

  // 1. Explicit tabId wins. Validate it exists; reject if not.
  //    DIALOG_ commands trust the provided tabId even if chrome.tabs.get fails
  //    (the dialog may already be gone — we want to send ACCEPT/DISMISS anyway).
  if (explicitTabId !== undefined) {
    if (!isDialogCommand) {
      try {
        await chrome.tabs.get(explicitTabId);
      } catch {
        throw new Error(
          `Invalid tab ID: ${explicitTabId}. Use 'surf tab.list' to see available tabs.`,
        );
      }
    }
    return { tabId: explicitTabId, autoCreated: false, closeAfter: false };
  }

  // 2. windowId given without tabId — keep current scoped-to-window behavior.
  //    User explicitly said "in window N" → that's intentional, don't auto-create.
  if (windowId !== undefined) {
    const tabs = await chrome.tabs.query({ active: true, windowId });
    let tab: chrome.tabs.Tab | undefined = tabs[0];
    if (!tab || isRestrictedUrl(tab.url)) {
      const allInWindow = await chrome.tabs.query({ windowId });
      tab = allInWindow.find((t) => !isRestrictedUrl(t.url));
    }
    if (!tab?.id) {
      const newTab = await chrome.tabs.create({
        windowId,
        url: "data:text/html,<html><head><title>Surf</title></head><body></body></html>",
        active: true,
      });
      if (!newTab.id) {
        throw new Error(`Failed to create tab in window ${windowId}`);
      }
      await new Promise((r) => setTimeout(r, 100));
      return {
        tabId: newTab.id,
        autoCreated: true,
        closeAfter: false,
        hint: `Auto-created tab in window ${windowId} (no usable tabs existed). Navigate to your target URL.`,
      };
    }
    return { tabId: tab.id, autoCreated: false, closeAfter: false };
  }

  // 3. No tabId, no windowId — classify the command.
  const wantsNewTab = Boolean(msg._newTab);
  const { bucket, warnReason } = resolveBucket(
    msg.type,
    typeof msg.url === "string" && msg.url.length > 0,
    wantsNewTab,
  );
  if (warnReason) {
    // Surface unclassified routing so devs see the gap during dev. Non-fatal.
    console.warn(`[tab-resolver] ${warnReason}`);
  }

  // INSPECT bucket (default) → use user's active tab. Skip only when --new-tab is set.
  if (bucket === "inspect" && !wantsNewTab) {
    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let tab: chrome.tabs.Tab | undefined = tabs[0];
    if (!tab || tab.url?.startsWith("chrome-extension://")) {
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs[0];
    }
    if (
      !tab ||
      tab.url?.startsWith("chrome-extension://") ||
      tab.url?.startsWith("chrome://")
    ) {
      tabs = await chrome.tabs.query({ active: true });
      tab = tabs.find(
        (t) =>
          !t.url?.startsWith("chrome-extension://") &&
          !t.url?.startsWith("chrome://"),
      );
    }
    if (!tab?.id) {
      throw new Error(
        "No active tab found. Use 'surf tab.new <url>' to create one, or 'surf tab.list' to see available tabs.",
      );
    }
    return { tabId: tab.id, autoCreated: false, closeAfter: false };
  }

  // BROWSE bucket, or INSPECT with --new-tab → auto-create background tab.
  const keepTab = Boolean(msg._keepTab);
  const createUrl =
    bucket === "browse" && msg.url
      ? msg.url
      : "data:text/html,<html><head><title>Surf</title></head><body></body></html>";

  const newTab = await chrome.tabs.create({
    url: createUrl,
    active: false,
  });
  if (!newTab.id) {
    throw new Error("Failed to create background tab");
  }
  return {
    tabId: newTab.id,
    autoCreated: true,
    closeAfter: !keepTab,
    hint: keepTab
      ? `Opened background tab (id ${newTab.id}) for isolation. Use 'surf tab.close ${newTab.id}' to remove it.`
      : `Opened background tab for isolation; will close after command completes.`,
  };
}