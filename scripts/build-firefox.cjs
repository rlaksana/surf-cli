#!/usr/bin/env node
/**
 * Build Firefox Extension
 *
 * Copies and converts Chrome extension files to Firefox WebExtensions format.
 */

const fs = require("fs");
const path = require("path");

const DIST_FIREFOX = "dist-firefox";
const DIST_CHROME = "dist";

// Ensure dist-firefox exists
const dirs = [DIST_FIREFOX, `${DIST_FIREFOX}/content`, `${DIST_FIREFOX}/icons`];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Files to copy and convert (chrome.* -> browser.*)
const convertFiles = ["accessibility-tree.js", "visual-indicator.js"];

for (const file of convertFiles) {
  const src = path.join(DIST_CHROME, "content", file);
  const dest = path.join(DIST_FIREFOX, "content", file);

  if (!fs.existsSync(src)) {
    console.error(`Source file not found: ${src}`);
    console.error("Run 'npm run build' first to build Chrome extension");
    process.exit(1);
  }

  let content = fs.readFileSync(src, "utf8");

  // Convert Chrome APIs to Firefox WebExtensions standard
  content = content.replace(/chrome\.runtime/g, "browser.runtime");
  content = content.replace(/chrome\.storage/g, "browser.storage");
  content = content.replace(/chrome\.tabs/g, "browser.tabs");

  fs.writeFileSync(dest, content);
  console.log(`Converted: ${dest}`);
}

// Copy icons
["16", "48", "128"].forEach((size) => {
  const src = path.join(DIST_CHROME, "icons", `icon-${size}.png`);
  const dest = path.join(DIST_FIREFOX, "icons", `icon-${size}.png`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${dest}`);
  }
});

// Write Firefox manifest.json
const manifest = {
  manifest_version: 2,
  name: "Surf",
  version: "2.7.0",
  description: "Browser automation CLI for AI agents",
  icons: {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  background: {
    scripts: ["background.js"],
    persistent: true,
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content/accessibility-tree.js"],
      run_at: "document_start",
      all_frames: true,
    },
    {
      matches: ["<all_urls>"],
      js: ["content/visual-indicator.js"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  permissions: [
    "storage",
    "nativeMessaging",
    "tabs",
    "webNavigation",
    "activeTab",
    "alarms",
    "notifications",
    "unlimitedStorage",
  ],
  browser_specific_settings: {
    gecko: {
      id: "surf-firefox-brandnew-unique-id-12345@surf.cli",
      strict_min_version: "109.0",
    },
  },
};

fs.writeFileSync(
  path.join(DIST_FIREFOX, "manifest.json"),
  JSON.stringify(manifest, null, 2)
);
console.log(`Created: ${DIST_FIREFOX}/manifest.json`);

// Write background.js - uses proper WebExtensions APIs only
const backgroundJs = `/**
 * Surf Firefox Extension - Background Script
 *
 * Receives commands via native messaging from firefox-host.cjs,
 * executes using WebExtensions APIs only.
 */

let nativePort = null;
let isConnected = false;
const pendingRequests = new Map();
let requestId = 0;

function initNativeMessaging() {
  try {
    nativePort = browser.runtime.connectNative("surf.firefox");
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      console.log("[Surf] Native host disconnected");
      isConnected = false;
      setTimeout(initNativeMessaging, 5000);
    });
    isConnected = true;
    console.log("[Surf] Connected to native host at", new Date().toISOString());
  } catch (err) {
    console.error("[Surf] Failed to connect:", err);
    setTimeout(initNativeMessaging, 5000);
  }
}

function handleNativeMessage(msg) {
  console.log("[Surf] >>> handleNativeMessage ENTERED msg =", JSON.stringify(msg));
  // Handle responses to pending requests
  if (msg.id && pendingRequests.has(msg.id)) {
    const { resolve, reject } = pendingRequests.get(msg.id);
    pendingRequests.delete(msg.id);
    if (msg.error) reject(new Error(msg.error));
    else resolve(msg.result || msg);
    return;
  }
  // Handle HOST_READY
  if (msg.type === "HOST_READY") {
    console.log("[Surf] Host ready");
    return;
  }
  // Handle command messages from native host
  if (msg.type && msg.id) {
    handleMessage(msg).then(function(result) {
      nativePort.postMessage({ id: msg.id, result: result });
    }).catch(function(e) {
      nativePort.postMessage({ id: msg.id, error: e.message });
    });
  }
}

function sendToNativeHost(message) {
  return new Promise((resolve, reject) => {
    if (!nativePort || !isConnected) {
      reject(new Error("Native host not connected"));
      return;
    }
    const id = ++requestId;
    pendingRequests.set(id, { resolve, reject });
    nativePort.postMessage({ ...message, id });
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }
    }, 30000);
  });
}

async function captureScreenshot(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    const screenshot = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return {
      base64: screenshot.replace(/^data:image\\/png;base64,/, ""),
      width: 0,
      height: 0,
    };
  } catch (err) {
    return { error: "Screenshot failed: " + err.message };
  }
}

async function navigate(tabId, url) {
  try {
    await browser.tabs.update(tabId, { url });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

async function evaluateScript(tabId, expression) {
  try {
    const results = await browser.tabs.executeScript(tabId, {
      code: expression,
      runAt: "document_end",
    });
    return { success: true, result: results[0] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function dispatchMouseEvent(tabId, type, x, y, button, clickCount) {
  const action = type === "mousePressed" ? "mousedown" : type === "mouseReleased" ? "mouseup" : "mousemove";
  const buttonMap = { none: 0, left: 0, middle: 1, right: 2 };

  try {
    await browser.tabs.executeScript(tabId, {
      code: "var el = document.elementFromPoint(" + Math.round(x) + ", " + Math.round(y) + "); if (el) { var evt = new MouseEvent('" + action + "', { bubbles: true, cancelable: true, clientX: " + Math.round(x) + ", clientY: " + Math.round(y) + ", button: " + (buttonMap[button] || 0) + " }); el.dispatchEvent(evt); }",
      runAt: "document_end",
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function dispatchKeyEvent(tabId, type, key) {
  const eventType = type === "keyDown" ? "keydown" : type === "keyUp" ? "keyup" : "keypress";
  try {
    await browser.tabs.executeScript(tabId, {
      code: "var evt = new KeyboardEvent('" + eventType + "', { bubbles: true, cancelable: true, key: '" + key + "' }); document.dispatchEvent(evt);",
      runAt: "document_end",
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function createTab(url, active) {
  try {
    const tab = await browser.tabs.create({ url: url || "about:blank", active: active || false });
    return { success: true, tabId: tab.id };
  } catch (err) {
    return { error: err.message };
  }
}

async function closeTab(tabId) {
  try {
    await browser.tabs.remove(tabId);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

async function getTabList() {
  try {
    const tabs = await browser.tabs.query({});
    return {
      tabs: tabs.map(function(t) {
        return {
          id: t.id,
          windowId: t.windowId,
          url: t.url,
          title: t.title,
          active: t.active,
        };
      }),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function getAccessibilityTree(tabId) {
  try {
    const result = await browser.tabs.executeScript(tabId, {
      code: "(function() { function getTree(node, depth) { if (depth > 15) return null; var children = []; try { if (node.childNodes && node.childNodes.length < 50) { for (var i = 0; i < node.childNodes.length; i++) { var child = getTree(node.childNodes[i], depth + 1); if (child) children.push(child); } } } catch(e) {} var role = '', name = ''; try { role = node.role || ''; } catch(e) {} try { name = node.name || ''; } catch(e) {} return { role: role, name: name, children: children }; } return JSON.stringify(getTree(document.documentElement, 0)); })()",
      runAt: "document_start",
    });
    return { success: true, tree: JSON.parse(result[0] || "{}") };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  console.log("[Surf] onMessage listener triggered:", JSON.stringify(message));
  handleMessage(message).then(sendResponse).catch(function(e) { sendResponse({ error: e.message }); });
  return true;
});

async function handleMessage(msg) {
  var type = msg.type;
  var tabId = msg.tabId;
  var params = msg;

  console.log("[Surf] handleMessage type='" + type + "' typeof='" + typeof type + "'");

  switch (type) {
    case "EXECUTE_SCREENSHOT":
      return captureScreenshot(tabId);
    case "PAGE_NAVIGATE":
      return navigate(tabId, params.url);
    case "RUNTIME_EVALUATE":
    case "EXECUTE_SCRIPT":
      return evaluateScript(tabId, params.expression || params.code);
    case "INPUT_DISPATCH_MOUSE_EVENT":
      return dispatchMouseEvent(tabId, params.mouseType, params.x, params.y, params.button, params.clickCount);
    case "INPUT_DISPATCH_KEY_EVENT":
      return dispatchKeyEvent(tabId, params.keyType, params.key);
    case "EMULATION_SET_DEVICE_METRICS":
      return { success: false, error: "Viewport emulation not supported in Firefox" };
    case "CONTENT_SCRIPT_MESSAGE":
      return browser.tabs.sendMessage(tabId, params.message);
    case "TAB_CREATE":
      console.log("[Surf] TAB_CREATE matched! url:", params.url, "active:", params.active);
      return createTab(params.url, params.active);
    case "TAB_CLOSE":
      return closeTab(tabId);
    case "TAB_LIST":
      return getTabList();
    case "TAB_SWITCH":
      return browser.tabs.update(tabId, { active: true }).then(function() { return { success: true }; });
    case "GET_ACCESSIBILITY_TREE":
      return getAccessibilityTree(tabId);
    case "PING":
      return { success: true };
    default:
      // FORCE UNIQUE TEST - if this appears, we know default case reached
      var testId = Math.random().toString(36).substring(7);
      console.log("[Surf] FORCE_UNIQUE_TEST_ID=" + testId + " type_received='" + type + "'");
      return { error: "FORCE_UNIQUE_" + testId + "_type='" + type + "'" };
  }
}

initNativeMessaging();
console.log("[Surf] Firefox extension background loaded");
`;

fs.writeFileSync(path.join(DIST_FIREFOX, "background.js"), backgroundJs);
console.log("Created: " + DIST_FIREFOX + "/background.js");

console.log("");
console.log("Firefox extension built successfully!");
console.log("To load in Firefox:");
console.log("1. Open about:debugging#/runtime/this-firefox");
console.log("2. Click \"Load Temporary Add-on\"");
console.log("3. Select " + DIST_FIREFOX + "/manifest.json");
