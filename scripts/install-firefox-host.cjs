#!/usr/bin/env node
/**
 * Install Firefox Native Messaging Host for Surf CLI
 *
 * Registers surf.firefox native messaging host in Firefox.
 * On Windows: adds registry entry
 * On Mac/Linux: creates JSON manifest in Firefox profile
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const HOST_NAME = "surf.firefox";
// Must match the extension ID in dist-firefox/manifest.json
const ALLOWED_EXTENSION_IDS = [
  "surf-firefox@surf.cli",
  "surf-firefox-v2@surf.cli",
  "surf-firefox-brandnew-unique-id-12345@surf.cli",
];

const NODE_PATHS = {
  darwin: ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"],
  linux: ["/usr/bin/node", "/usr/local/bin/node"],
  win32: [
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe",
  ],
};

function findNode() {
  if (process.env.SURF_NODE_PATH && fs.existsSync(process.env.SURF_NODE_PATH)) {
    return process.env.SURF_NODE_PATH;
  }
  const platform = process.platform;
  const paths = NODE_PATHS[platform] || [];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const which = platform === "win32" ? "where" : "which";
    const result = execSync(`${which} node`, { encoding: "utf8" }).trim();
    if (result) return result.split("\n")[0];
  } catch {}
  return null;
}

function findNpmGlobalRoot() {
  try {
    return execSync("npm root -g", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function getWrapperDir() {
  const platform = process.platform;
  const home = os.homedir();
  switch (platform) {
    case "darwin":
      return path.join(home, "Library/Application Support/surf-cli");
    case "linux":
      return path.join(home, ".local/share/surf-cli");
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA || path.join(home, "AppData/Local"),
        "surf-cli"
      );
    default:
      return null;
  }
}

function getHostPath() {
  if (process.env.SURF_HOST_PATH && fs.existsSync(process.env.SURF_HOST_PATH)) {
    return process.env.SURF_HOST_PATH;
  }
  const npmRoot = findNpmGlobalRoot();
  if (npmRoot) {
    const globalPath = path.join(npmRoot, "surf-cli/native/host.cjs");
    if (fs.existsSync(globalPath)) return globalPath;
  }
  // Use unified host.cjs which handles both Chrome and Firefox
  const localPath = path.resolve(__dirname, "../native/host.cjs");
  if (fs.existsSync(localPath)) return localPath;
  return null;
}

function createWrapper(wrapperDir, nodePath, hostPath) {
  const platform = process.platform;
  fs.mkdirSync(wrapperDir, { recursive: true });

  if (platform === "win32") {
    const batPath = path.join(wrapperDir, "firefox-host-wrapper.bat");
    const content = `@echo off\r\n"${nodePath}" "${hostPath}"\r\n`;
    fs.writeFileSync(batPath, content);
    return batPath;
  } else {
    const shPath = path.join(wrapperDir, "firefox-host-wrapper.sh");
    const hostDir = path.dirname(hostPath);
    const content = `#!/bin/bash\ncd "${hostDir}"\nexec "${nodePath}" "${hostPath}"\n`;
    fs.writeFileSync(shPath, content);
    fs.chmodSync(shPath, "755");
    return shPath;
  }
}

function installWindowsRegistry(wrapperPath) {
  const regPath = `HKCU\\Software\\Mozilla\\Firefox\\NativeMessagingHosts\\${HOST_NAME}`;

  const manifestDir = getWrapperDir();
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);

  const manifest = {
    name: HOST_NAME,
    description: "Surf CLI Firefox Native Host",
    path: wrapperPath,
    type: "stdio",
    allowed_extensions: ALLOWED_EXTENSION_IDS,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  try {
    execSync(`reg add "${regPath}" /ve /t REG_SZ /d "${manifestPath}" /f`, {
      stdio: "pipe",
    });
    return manifestPath;
  } catch (e) {
    console.error(`Failed to add registry entry: ${e.message}`);
    return null;
  }
}

function installMacLinux(wrapperPath) {
  // On Mac/Linux, Firefox stores native messaging hosts in the profile
  // We install system-wide in the Firefox app support directory
  const platform = process.platform;
  let manifestDir;

  if (platform === "darwin") {
    manifestDir = path.join(
      os.homedir(),
      "Library/Application Support/Mozilla/NativeMessagingHosts"
    );
  } else {
    // Linux
    manifestDir = path.join(
      os.homedir(),
      ".mozilla/native-messaging-hosts"
    );
  }

  fs.mkdirSync(manifestDir, { recursive: true });

  const manifest = {
    name: HOST_NAME,
    description: "Surf CLI Firefox Native Host",
    path: wrapperPath,
    type: "stdio",
    allowed_extensions: ALLOWED_EXTENSION_IDS,
  };

  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function main() {
  const nodePath = findNode();
  if (!nodePath) {
    console.error("Error: Could not find Node.js");
    console.error("Make sure Node.js is installed and in your PATH");
    process.exit(1);
  }

  const hostPath = getHostPath();
  if (!hostPath) {
    console.error("Error: Could not find firefox-host.cjs");
    console.error("Make sure surf-cli is installed correctly");
    process.exit(1);
  }

  const wrapperDir = getWrapperDir();
  if (!wrapperDir) {
    console.error("Error: Unsupported platform");
    process.exit(1);
  }

  console.log(`Platform: ${process.platform}`);
  console.log(`Node: ${nodePath}`);
  console.log(`Host: ${hostPath}`);
  console.log(`Wrapper dir: ${wrapperDir}`);
  console.log("");

  const wrapperPath = createWrapper(wrapperDir, nodePath, hostPath);
  console.log(`Created wrapper: ${wrapperPath}`);
  console.log("");

  let result;
  if (process.platform === "win32") {
    result = installWindowsRegistry(wrapperPath);
  } else {
    result = installMacLinux(wrapperPath);
  }

  if (result) {
    console.log(`Installed native messaging host: ${result}`);
    console.log("");
    console.log("Done! Restart Firefox for changes to take effect.");
  } else {
    console.error("Failed to install native messaging host");
    process.exit(1);
  }
}

main();
