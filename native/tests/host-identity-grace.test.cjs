#!/usr/bin/env node
/**
 * host-identity-grace.test.cjs — self-heal check for the host identity grace timer.
 *
 * The host must exit by itself (code 1) when no EXTENSION_HELLO arrives within
 * SURF_IDENTITY_GRACE_MS, and must stay alive past the grace window when a
 * well-formed hello IS received.
 *
 * Run: node native/tests/host-identity-grace.test.cjs
 */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOST = path.join(__dirname, "..", "host.cjs");
const LOG_FILE = path.join(os.tmpdir(), "surf", "surf-host.log"); // host log() target
const GRACE_MS = 1200;
const FRAME = (obj) => {
  const json = JSON.stringify(obj);
  const buf = Buffer.alloc(4 + Buffer.byteLength(json));
  buf.writeUInt32LE(Buffer.byteLength(json), 0);
  buf.write(json, 4);
  return buf;
};
const HELLO = FRAME({
  type: "EXTENSION_HELLO",
  protocolVersion: 2,
  extensionVersion: "test",
  capabilities: [],
  browserInstanceId: "test-instance",
  browserEpoch: "test-epoch",
});

function spawnHost() {
  return spawn(process.execPath, [HOST], {
    env: {
      ...process.env,
      SURF_SOCKET: `//./pipe/surf-grace-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
      SURF_IDENTITY_GRACE_MS: String(GRACE_MS),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function hostLogTail() {
  try {
    return fs.readFileSync(LOG_FILE, "utf8").slice(-4000);
  } catch {
    return "";
  }
}

async function testSelfExit() {
  const child = spawnHost();
  const code = await new Promise((resolve) => {
    const killer = setTimeout(() => child.kill("SIGKILL"), GRACE_MS + 5000);
    child.on("exit", (code) => { clearTimeout(killer); resolve(code); });
  });
  if (code !== 1) {
    throw new Error(`no-hello: expected exit code 1, got ${code}. Log: ${hostLogTail()}`);
  }
  if (!hostLogTail().includes("No EXTENSION_HELLO received")) {
    throw new Error(`no-hello: missing self-heal log line in ${LOG_FILE}`);
  }
}

async function testHelloKeepsAlive() {
  const child = spawnHost();
  child.stdin.write(HELLO);
  let exited = null;
  child.on("exit", (code) => { exited = code; });
  await new Promise((resolve) => setTimeout(resolve, GRACE_MS + 2000));
  child.kill("SIGKILL");
  if (exited !== null) {
    throw new Error(`hello: host exited early with code ${exited}. Log: ${hostLogTail()}`);
  }
  if (!hostLogTail().includes("Browser identity connected: test-instance")) {
    throw new Error(`hello: identity was not registered in ${LOG_FILE}`);
  }
}

(async () => {
  await testSelfExit();
  console.log("PASS no-hello: host self-exits with code 1");
  await testHelloKeepsAlive();
  console.log("PASS hello: host registers identity and survives the grace window");
  process.exit(0);
})().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
