#!/usr/bin/env node
/**
 * Surf Firefox Native Host
 *
 * Bridge between CLI (Unix socket) and Firefox extension (native messaging).
 *
 * Architecture:
 *   CLI → Unix socket → firefox-host.cjs → stdin/stdout → Firefox extension
 *                                                       ↓
 *   CLI ← Unix socket ← firefox-host.cjs ← stdout ← Firefox extension
 *
 * Native messaging protocol: JSON with 32-bit little-endian length prefix
 */

const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const IS_WIN = process.platform === "win32";
const SURF_TMP = IS_WIN ? path.join(os.tmpdir(), "surf") : "/tmp";
const SOCKET_PATH = IS_WIN ? "//./pipe/surf-firefox" : "/tmp/surf-firefox.sock";

// Native messaging protocol: 4-byte length prefix + JSON
function writeMessage(msg) {
  const json = JSON.stringify(msg);
  const len = Buffer.byteLength(json);
  const buf = Buffer.alloc(4 + len);
  buf.writeUInt32LE(len, 0);
  buf.write(json, 4);
  process.stdout.write(buf);
}

function readMessage(buffer) {
  if (buffer.length < 4) return null;
  const msgLen = buffer.readUInt32LE(0);
  if (buffer.length < 4 + msgLen) return null;
  const jsonStr = buffer.slice(4, 4 + msgLen).toString("utf8");
  return { msg: JSON.parse(jsonStr), remaining: buffer.slice(4 + msgLen) };
}

const LOG_FILE = path.join(SURF_TMP, "surf-firefox-host.log");

const log = (msg) => {
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
};

log("Firefox host starting...");

// Track CLI sockets
const connectedSockets = new Set();
const pendingRequests = new Map();
const pendingToolRequests = new Map();
let requestCounter = 0;

// ============================================================================
// Firefox Extension Communication (via stdin/stdout)
// ============================================================================

let firefoxExtensionPort = null;
let firefoxConnected = false;

function connectToFirefoxExtension() {
  // In Firefox, connectNative spawns the process and we communicate via stdin/stdout
  // No explicit connection needed - Firefox extension connects to us
  log("Waiting for Firefox extension to connect...");
}

// Forward message to Firefox extension via native messaging protocol
function sendToExtension(msg) {
  if (!firefoxConnected) {
    log("Firefox extension not connected, cannot send: " + JSON.stringify(msg));
    return;
  }
  writeMessage(msg);
}

// ============================================================================
// Message Handling
// ============================================================================

function handleExtensionMessage(msg) {
  log("From Firefox extension: " + JSON.stringify(msg));

  // Handle HOST_READY
  if (msg.type === "HOST_READY") {
    firefoxConnected = true;
    log("Firefox extension connected");
    return;
  }

  // Handle response to a CLI request
  if (msg.id && pendingRequests.has(msg.id)) {
    const { socket } = pendingRequests.get(msg.id);
    pendingRequests.delete(msg.id);
    try {
      socket.write(`${JSON.stringify(msg)}\n`);
    } catch (e) {
      log(`Error writing to CLI socket: ${e.message}`);
    }
    return;
  }

  // Handle tool response
  if (msg.id && pendingToolRequests.has(msg.id)) {
    const pending = pendingToolRequests.get(msg.id);
    pendingToolRequests.delete(msg.id);
    if (pending.onComplete) {
      pending.onComplete(msg);
    }
    return;
  }
}

function handleToolRequest(msg, socket) {
  const { method, params } = msg;
  const originalId = msg.id || null;

  if (method !== "execute_tool") {
    socket.write(`${JSON.stringify({ error: `Unknown method: ${method}` })}\n`);
    return;
  }

  const { tool, args } = params || {};
  const tabId = msg.tabId || params?.tabId || args?.tabId;

  if (!tool) {
    socket.write(`${JSON.stringify({ error: "No tool specified" })}\n`);
    return;
  }

  log(`Tool request: ${tool} tabId=${tabId}`);

  // Map tool to extension message type
  const extensionMsg = mapToolToExtensionMessage(tool, args, tabId);
  if (!extensionMsg) {
    socket.write(`${JSON.stringify({ error: `Unknown tool: ${tool}` })}\n`);
    return;
  }

  const id = ++requestCounter;
  pendingToolRequests.set(id, {
    socket,
    originalId,
    tool,
    onComplete: (result) => {
      if (result.error) {
        socket.write(`${JSON.stringify({ error: result.error })}\n`);
      } else {
        socket.write(`${JSON.stringify({ result })}\n`);
      }
    },
  });

  sendToExtension({ ...extensionMsg, id });
}

function mapToolToExtensionMessage(tool, args, tabId) {
  const base = { tabId };

  switch (tool) {
    case "tab.new":
      return { type: "TAB_CREATE", url: args?.url || "about:blank", active: false, ...base };
    case "tab.close":
      return { type: "TAB_CLOSE", ...base };
    case "navigate":
      return { type: "PAGE_NAVIGATE", url: args?.url, ...base };
    case "screenshot":
      return { type: "EXECUTE_SCREENSHOT", ...base };
    case "js":
    case "evaluate":
      return { type: "RUNTIME_EVALUATE", expression: args?.expression || args?.code, ...base };
    case "click":
      return {
        type: "INPUT_DISPATCH_MOUSE_EVENT",
        type: "mousePressed",
        x: args?.x || 0,
        y: args?.y || 0,
        button: "left",
        clickCount: 1,
        ...base,
      };
    case "type":
      return { type: "RUNTIME_EVALUATE", expression: `document.activeElement.value='${args?.text}'`, ...base };
    case "key":
      return { type: "INPUT_DISPATCH_KEY_EVENT", type: "keyDown", key: args?.key, ...base };
    case "wait":
      return { type: "LOCAL_WAIT", seconds: args?.seconds || 1 };
    case "get_tree":
    case "page.read":
      return { type: "GET_ACCESSIBILITY_TREE", ...base };
    default:
      // Forward as-is for unimplemented tools
      return { type: tool.toUpperCase(), ...base, ...args };
  }
}

// ============================================================================
// CLI Socket Server
// ============================================================================

// Clean up existing socket
if (!IS_WIN) {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}
} else {
  try {
    fs.unlinkSync("\\\\.\\" + SOCKET_PATH.replace("//./pipe/", "pipe\\"));
  } catch {}
}

const server = net.createServer((socket) => {
  log("CLI client connected");
  connectedSockets.add(socket);

  socket.on("close", () => {
    connectedSockets.delete(socket);
    log("CLI client disconnected");
  });

  socket.on("error", (err) => {
    log(`CLI socket error: ${err.message}`);
  });

  let dataBuffer = "";

  socket.on("data", (data) => {
    dataBuffer += data.toString();
    const lines = dataBuffer.split("\n");
    dataBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line);
        log(`From CLI: ${msg.type} ${msg.method || ""}`);

        if (msg.type === "tool_request") {
          handleToolRequest(msg, socket);
        } else {
          // Forward to extension
          const id = ++requestCounter;
          pendingRequests.set(id, { socket });
          sendToExtension({ ...msg, id });
        }
      } catch (e) {
        log(`Error parsing CLI message: ${e.message}`);
      }
    }
  });
});

server.listen(SOCKET_PATH, () => {
  log(`Socket server listening on ${SOCKET_PATH}`);
  if (!IS_WIN) {
    try {
      fs.chmodSync(SOCKET_PATH, 0o600);
    } catch {}
  }
  connectToFirefoxExtension();
});

server.on("error", (err) => {
  log(`Server error: ${err.message}`);
});

// ============================================================================
// Extension Communication (stdin/stdout)
// ============================================================================

let inputBuffer = Buffer.alloc(0);

process.stdin.on("readable", () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);

    // Process messages
    while (true) {
      const parsed = readMessage(inputBuffer);
      if (!parsed) break;
      inputBuffer = parsed.remaining;
      handleExtensionMessage(parsed.msg);
    }
  }
});

process.stdin.on("end", () => {
  log("Firefox extension disconnected");
  firefoxConnected = false;
});

process.stdin.on("error", (err) => {
  log(`stdin error: ${err.message}`);
});

process.stdout.on("error", (err) => {
  log(`stdout error: ${err.message}`);
});

// ============================================================================
// Signal Handling
// ============================================================================

process.on("SIGTERM", () => {
  log("SIGTERM received");
  server.close();
  if (!IS_WIN) {
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {}
  }
  process.exit(0);
});

process.on("SIGINT", () => {
  log("SIGINT received");
  server.close();
  if (!IS_WIN) {
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {}
  }
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}\n${err.stack}`);
  process.exit(1);
});

log("Firefox host initialization complete, waiting for connections...");
