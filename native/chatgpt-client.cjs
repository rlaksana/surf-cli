const CHATGPT_URL = "https://chatgpt.com/";

const SELECTORS = {
  promptTextarea:
    '#prompt-textarea, [data-testid="composer-textarea"], textarea[name="prompt-textarea"], .ProseMirror, [contenteditable="true"][data-virtualkeyboard="true"]',
  sendButton:
    'button[data-testid="send-button"], button[data-testid*="composer-send"], form button[type="submit"]',
  modelButton: '[data-testid="model-switcher-dropdown-button"]',
  menuContainer: '[role="menu"], [data-radix-collection-root]',
  menuItem: 'button, [role="menuitem"], [role="menuitemradio"], [data-testid*="model-switcher-"]',
  assistantMessage: '[data-message-author-role="assistant"], [data-turn="assistant"]',
  stopButton: '[data-testid="stop-button"]',
  finishedActions:
    'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"]',
  conversationTurn:
    'article[data-testid^="conversation-turn"], div[data-testid^="conversation-turn"]',
  fileInput: 'input[type="file"]',
  cloudflareScript: 'script[src*="/challenge-platform/"]',
  // Detects thinking model indicator (e.g., "Thought for 1m 29s")
  thinkingIndicator: '[data-message-model-slug*="thinking"]',
  // Voice mode button appears when stop button transforms after completion
  voiceButton: '[aria-label="Voice mode"], [data-testid="voice-mode-button"]',
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildClickDispatcher() {
  return `function dispatchClickSequence(target){
    if(!target || !(target instanceof EventTarget)) return false;
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of types) {
      const common = { bubbles: true, cancelable: true, view: window };
      let event;
      if (type.startsWith('pointer') && 'PointerEvent' in window) {
        event = new PointerEvent(type, { ...common, pointerId: 1, pointerType: 'mouse' });
      } else {
        event = new MouseEvent(type, common);
      }
      target.dispatchEvent(event);
    }
    return true;
  }`;
}

function hasRequiredCookies(cookies) {
  if (!cookies || !Array.isArray(cookies)) {
    return false;
  }
  // Valid: __Secure-next-auth.session-token with non-empty value
  // Valid: __Secure-next-auth.session-token.<digits> with non-empty value (chunked sessions)
  // Invalid: session-token-extra, session-token., session-token.foo, etc.
  const sessionCookie = cookies.find((c) => {
    const name = c.name;
    if (!c.value) {
      return false;
    }
    if (name === "__Secure-next-auth.session-token") {
      return true;
    }
    if (name.startsWith("__Secure-next-auth.session-token.")) {
      const suffix = name.slice("__Secure-next-auth.session-token.".length);
      if (/^\d+$/.test(suffix)) {
        return true; // Only numeric suffixes (.0, .1, etc.)
      }
    }
    return false;
  });
  return Boolean(sessionCookie);
}

async function evaluate(cdp, expression, timeoutMs = 10000) {
  const result = await Promise.race([
    cdp(expression),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("CDP evaluate timeout")), timeoutMs)
    ),
  ]);
  if (result.exceptionDetails) {
    const desc =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Evaluation failed";
    throw new Error(desc);
  }
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result?.value;
}

async function waitForPageLoad(cdp, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.readyState");
    if (ready === "complete" || ready === "interactive") {
      return;
    }
    await delay(100);
  }
  throw new Error("Page did not load in time");
}

async function isCloudflareBlocked(cdp) {
  const title = await evaluate(cdp, "document.title.toLowerCase()");
  if (title?.includes("just a moment")) {
    return true;
  }
  const hasScript = await evaluate(
    cdp,
    `Boolean(document.querySelector('${SELECTORS.cloudflareScript}'))`,
  );
  return hasScript;
}

async function checkLoginStatus(cdp) {
  const result = await evaluate(
    cdp,
    `(async () => {
      try {
        const response = await fetch('/backend-api/me', { 
          cache: 'no-store', 
          credentials: 'include' 
        });
        const hasLoginCta = Array.from(document.querySelectorAll('a[href*="/auth/login"], button'))
          .some(el => {
            const text = (el.textContent || '').toLowerCase().trim();
            return text.startsWith('log in') || text.startsWith('sign in');
          });
        return { 
          status: response.status, 
          hasLoginCta,
          url: location.href
        };
      } catch (e) {
        return { status: 0, error: e.message, url: location.href };
      }
    })()`,
  );
  return result || { status: 0 };
}

async function waitForPromptReady(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const selectors = JSON.stringify(SELECTORS.promptTextarea.split(", "));
  while (Date.now() < deadline) {
    const found = await evaluate(
      cdp,
      `(() => {
        const selectors = ${selectors};
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (node && !node.hasAttribute('disabled')) {
            return true;
          }
        }
        return false;
      })()`,
    );
    if (found) {
      return true;
    }
    await delay(200);
  }
  return false;
}

async function selectModel(cdp, desiredModel, timeoutMs = 8000) {
  const modelButton = await evaluate(
    cdp,
    `(() => {
      const btn = document.querySelector('${SELECTORS.modelButton}');
      return btn ? true : false;
    })()`,
  );
  if (!modelButton) {
    throw new Error("Model selector button not found");
  }
  await evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const btn = document.querySelector('${SELECTORS.modelButton}');
      if (btn) dispatchClickSequence(btn);
    })()`,
  );
  await delay(300);
  // Select from menu - loop in Node.js to avoid CDP timeout issues
  const normalizedModel = desiredModel.toLowerCase().replace(/[^a-z0-9]/g, "");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await evaluate(
      cdp,
      `(() => {
        ${buildClickDispatcher()}
        const targetModel = ${JSON.stringify(normalizedModel)};
        const menuSelector = '${SELECTORS.menuContainer}';
        const itemSelector = '${SELECTORS.menuItem}';
        const normalize = (text) => (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        
        const menu = document.querySelector(menuSelector);
        if (!menu) {
          return { found: false, waiting: true };
        }
        const items = Array.from(menu.querySelectorAll(itemSelector));
        let bestMatch = null;
        let bestScore = 0;
        for (const item of items) {
          const text = normalize(item.textContent || '');
          const testId = normalize(item.getAttribute('data-testid') || '');
          let score = 0;
          if (text.includes(targetModel) || testId.includes(targetModel)) score = 100;
          else if (targetModel.includes(text) || targetModel.includes(testId)) score = 50;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = item;
          }
        }
        if (bestMatch) {
          dispatchClickSequence(bestMatch);
          return { found: true, success: true, label: bestMatch.textContent?.trim() };
        }
        return { found: true, success: false, error: 'No matching model in menu' };
      })()`,
    );

    if (result?.found) {
      if (result.success) {
        await delay(200);
        return result.label;
      }
      throw new Error(`Model not found: ${desiredModel}`);
    }

    await delay(100);
  }

  throw new Error(`Model not found: ${desiredModel} (timeout)`);
}

async function typePrompt(cdp, inputCdp, prompt) {
  const selectors = JSON.stringify(SELECTORS.promptTextarea.split(", "));
  const encodedPrompt = JSON.stringify(prompt);
  const focused = await evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const selectors = ${selectors};
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        dispatchClickSequence(node);
        if (typeof node.focus === 'function') node.focus();
        const doc = node.ownerDocument;
        const selection = doc?.getSelection?.();
        if (selection) {
          const range = doc.createRange();
          range.selectNodeContents(node);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return true;
      }
      return false;
    })()`,
  );
  if (!focused) {
    throw new Error("Failed to focus prompt textarea");
  }
  await inputCdp("Input.insertText", { text: prompt });
  await delay(300);
  const verified = await evaluate(
    cdp,
    `(() => {
      const selectors = ${selectors};
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const text = node.innerText || node.value || node.textContent || '';
        if (text.trim().length > 0) return true;
      }
      return false;
    })()`,
  );
  if (!verified) {
    await evaluate(
      cdp,
      `(() => {
        const editor = document.querySelector('#prompt-textarea');
        const fallback = document.querySelector('textarea[name="prompt-textarea"]');
        if (fallback) {
          fallback.value = ${encodedPrompt};
          fallback.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${encodedPrompt}, inputType: 'insertFromPaste' }));
        }
        if (editor) {
          editor.textContent = ${encodedPrompt};
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${encodedPrompt}, inputType: 'insertFromPaste' }));
        }
      })()`,
    );
  }
}

async function clickSend(cdp, inputCdp) {
  const selectors = SELECTORS.sendButton.split(", ");
  const selectorsJson = JSON.stringify(selectors);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await evaluate(
      cdp,
      `(() => {
        ${buildClickDispatcher()}
        const selectors = ${selectorsJson};
        let button = null;
        for (const selector of selectors) {
          button = document.querySelector(selector);
          if (button) break;
        }
        if (!button) return 'missing';
        const disabled = button.hasAttribute('disabled') || 
                        button.getAttribute('aria-disabled') === 'true' ||
                        button.getAttribute('data-disabled') === 'true';
        if (disabled) return 'disabled';
        dispatchClickSequence(button);
        return 'clicked';
      })()`,
    );
    if (result === "clicked") {
      return true;
    }
    if (result === "missing") {
      break;
    }
    await delay(100);
  }
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: "\r",
  });
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  return true;
}

async function waitForResponse(cdp, timeoutMs = 2700000) {
  const deadline = Date.now() + timeoutMs;
  let previousLength = 0;
  let stableCycles = 0;
  const requiredStableCycles = 6;
  const minStableMs = 1200;
  let lastChangeAt = Date.now();
  // Safety: if the text has been stable for a very long time but selectors
  // are broken (e.g. stop button still "visible"), force completion so the
  // CLI doesn't hang forever.
  const FORCE_COMPLETE_MS = 30000;
  while (Date.now() < deadline) {
    const snapshot = await evaluate(
      cdp,
      `(() => {
        const CONVERSATION_SELECTOR = '${SELECTORS.conversationTurn}';
        const ASSISTANT_SELECTOR = '${SELECTORS.assistantMessage}';
        const STOP_SELECTOR = '${SELECTORS.stopButton}';
        const FINISHED_SELECTOR = '${SELECTORS.finishedActions}';
        const VOICE_SELECTOR = '${SELECTORS.voiceButton}';
        const isAssistantTurn = (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const role = (node.getAttribute('data-message-author-role') || '').toLowerCase();
          if (role === 'assistant') return true;
          const turn = (node.getAttribute('data-turn') || '').toLowerCase();
          if (turn === 'assistant') return true;
          return Boolean(node.querySelector(ASSISTANT_SELECTOR));
        };
        const turns = Array.from(document.querySelectorAll(CONVERSATION_SELECTOR));
        let lastAssistantTurn = null;
        for (let i = turns.length - 1; i >= 0; i--) {
          if (isAssistantTurn(turns[i])) {
            lastAssistantTurn = turns[i];
            break;
          }
        }
        if (!lastAssistantTurn) {
          return { text: '', stopVisible: Boolean(document.querySelector(STOP_SELECTOR)), finished: false };
        }
        const messageRoot = lastAssistantTurn.querySelector(ASSISTANT_SELECTOR) || lastAssistantTurn;
        const contentRoot = messageRoot.querySelector('.markdown') ||
                           messageRoot.querySelector('[data-message-content]') ||
                           messageRoot.querySelector('.prose') ||
                           messageRoot;
        const text = (contentRoot?.innerText || contentRoot?.textContent || '').trim();
        const stopVisible = Boolean(document.querySelector(STOP_SELECTOR));
        const finished = Boolean(lastAssistantTurn.querySelector(FINISHED_SELECTOR));
        const voiceVisible = Boolean(document.querySelector(VOICE_SELECTOR));
        const messageId = messageRoot.getAttribute('data-message-id') || null;
        // Detect if this is a thinking model response (has thinking indicator but no finished actions yet)
        const hasThinkingIndicator = Boolean(lastAssistantTurn.querySelector('[data-message-model-slug*="thinking"]'));
        return { text, stopVisible, finished, voiceVisible, messageId, turnIndex: turns.length - 1, hasThinkingIndicator };
      })()`,
    );
    if (!snapshot) {
      await delay(400);
      continue;
    }
    const currentLength = (snapshot.text || "").length;
    if (currentLength > previousLength) {
      previousLength = currentLength;
      stableCycles = 0;
      lastChangeAt = Date.now();
    } else {
      stableCycles++;
    }
    const stableMs = Date.now() - lastChangeAt;
    // Safety: if text has been stable for 30s+ and has content, force return.
    // This prevents the CLI from hanging forever when selectors are stale
    // (e.g. stop button always "visible", thinking indicator never clears).
    if (stableMs >= FORCE_COMPLETE_MS && currentLength > 0) {
      return {
        text: snapshot.text,
        messageId: snapshot.messageId,
        turnIndex: snapshot.turnIndex,
      };
    }
    if (!snapshot.stopVisible) {
      const stableEnough = stableCycles >= requiredStableCycles && stableMs >= minStableMs;
      const finishedVisible = snapshot.finished;
      const voiceVisible = snapshot.voiceVisible;
      // Voice button appears when stop button transforms after completion
      // If voice is visible, response is done regardless of thinking indicator
      if (voiceVisible && currentLength > 0) {
        return {
          text: snapshot.text,
          messageId: snapshot.messageId,
          turnIndex: snapshot.turnIndex,
        };
      }
      // For thinking models: if we detect a thinking indicator, keep waiting even if stable
      // The thinking block has no stop button but is not the final response
      if ((finishedVisible || stableEnough) && currentLength > 0) {
        // Check if this is a thinking block (has thinking indicator but no finished actions)
        const isThinkingBlock = snapshot.hasThinkingIndicator && !snapshot.finished;
        if (isThinkingBlock) {
          // Reset stability and keep waiting for actual response
          stableCycles = 0;
          lastChangeAt = Date.now();
          await delay(400);
          continue;
        }
        return {
          text: snapshot.text,
          messageId: snapshot.messageId,
          turnIndex: snapshot.turnIndex,
        };
      }
    }
    await delay(400);
  }
  throw new Error("Response timeout");
}

async function query(options) {
  const {
    prompt: originalPrompt,
    model,
    file,
    timeout = 2700000,
    getCookies,
    createTab,
    closeTab,
    cdpEvaluate,
    cdpCommand,
    uploadFile,
    log = () => {},
  } = options;

  let prompt = originalPrompt;
  const startTime = Date.now();
  log("Starting ChatGPT query");
  const { cookies } = await getCookies();
  const cookieNames = cookies?.map((c) => c.name) || [];
  if (!hasRequiredCookies(cookies)) {
    throw new Error(
      `ChatGPT login required. Found ${cookies?.length || 0} cookies: ${cookieNames.join(", ")}`,
    );
  }
  log(`Got ${cookies.length} cookies`);
  const tabInfo = await createTab();
  const { tabId } = tabInfo;
  if (!tabId) {
    throw new Error("Failed to create ChatGPT tab");
  }
  log(`Created tab ${tabId}`);

  const cdp = (expr) => cdpEvaluate(tabId, expr);
  const inputCdp = (method, params) => cdpCommand(tabId, method, params);

  try {
    await waitForPageLoad(cdp);
    log("Page loaded");
    if (await isCloudflareBlocked(cdp)) {
      throw new Error("Cloudflare challenge detected - complete in browser");
    }
    const loginStatus = await checkLoginStatus(cdp);
    log(`DEBUG loginStatus: ${JSON.stringify(loginStatus)}`);
    if (loginStatus.error) {
      throw new Error(`ChatGPT login check failed: ${loginStatus.error}`);
    }
    if (loginStatus.status !== 200 || loginStatus.hasLoginCta) {
      throw new Error(`ChatGPT login required. loginStatus: ${JSON.stringify(loginStatus)}`);
    }
    log("Login verified");
    const promptReady = await waitForPromptReady(cdp);
    if (!promptReady) {
      throw new Error("Prompt textarea not ready");
    }
    log("Prompt ready");
    if (model) {
      const selectedLabel = await selectModel(cdp, model);
      log(`Selected model: ${selectedLabel}`);
    }
    if (file) {
      const fs = require("node:fs");
      const path = require("node:path");

      const absolutePath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${file}`);
      }

      const fileName = path.basename(absolutePath);
      const fileExt = path.extname(absolutePath).toLowerCase();

      // Text-based extensions only
      const textExtensions = [
        ".js",
        ".ts",
        ".tsx",
        ".jsx",
        ".py",
        ".java",
        ".c",
        ".cpp",
        ".h",
        ".hpp",
        ".go",
        ".rs",
        ".rb",
        ".php",
        ".html",
        ".htm",
        ".css",
        ".scss",
        ".less",
        ".json",
        ".md",
        ".txt",
        ".sh",
        ".bash",
        ".zsh",
        ".yaml",
        ".yml",
        ".xml",
        ".sql",
        ".gitignore",
        ".env",
        ".toml",
        ".ini",
        ".cfg",
        ".conf",
        ".log",
        ".csv",
        ".tsv",
      ];

      if (!textExtensions.includes(fileExt)) {
        throw new Error(`Unsupported file type: ${fileExt}. Only text files are supported.`);
      }

      const fileContent = fs.readFileSync(absolutePath, "utf-8");
      prompt = `File: ${fileName}\n\n\`\`\`\n${fileContent}\n\`\`\`\n\n---\n\n${prompt}`;
      log(`Attached file: ${fileName} (${fileContent.length} chars)`);
    }
    await typePrompt(cdp, inputCdp, prompt);
    log("Prompt typed");
    await clickSend(cdp, inputCdp);
    log("Prompt sent, waiting for response...");
    const response = await waitForResponse(cdp, timeout);
    log(`Response received (${response.text.length} chars)`);
    return {
      response: response.text,
      model: model || "current",
      messageId: response.messageId,
      tookMs: Date.now() - startTime,
    };
  } finally {
    if (tabId) {
      console.error("[ChatGPT] Closing tab:", tabId);
      try {
        await Promise.race([
          closeTab(tabId),
          new Promise((_, reject) =>
            setTimeout(() =>
              reject(new Error("closeTab timeout")), 5000)
          ),
        ]);
        console.error("[ChatGPT] Tab closed successfully:", tabId);
      } catch (e) {
        console.error("[ChatGPT] Tab close failed:", e);
      }
    }
  }
}

/**
 * Strips trailing chrome clusters from ChatGPT response text.
 * Chrome button labels (Copy, Read aloud, Share, Retry) appear as
 * standalone lines after the actual content. Edit is NOT chrome — it is
 * a legitimate content action that should be preserved.
 *
 * Algorithm:
 * 1. Strip trailing \r\n to avoid creating empty elements on split
 * 2. Split on \r\n (any combination)
 * 3. Strip trailing chrome cluster (2+ consecutive chrome at end)
 * 4. Strip outer blank lines
 * @param {string} text
 * @returns {string}
 */
function cleanChatGPTResponseText(text) {
  if (!text) {
    return "";
  }
  // Strip trailing \r\n to avoid creating an empty element on split
  const stripped = text.replace(/\r\n$/, "").replace(/\n$/, "");
  const lines = stripped.split(/\r?\n/);
  // Chrome button labels — Edit is NOT chrome (preserved as content)
  const chromeSet = new Set(["Copy", "Read aloud", "Share", "Retry"]);

  // Count consecutive chrome at the end
  let trailingChrome = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (chromeSet.has(lines[i].trim())) {
      trailingChrome++;
    } else {
      break;
    }
  }

  // Only strip trailing chrome if 2+ consecutive (a "cluster")
  let end = lines.length;
  if (trailingChrome >= 2) {
    end = lines.length - trailingChrome;
  }

  // Strip outer blank lines
  let start = 0;
  while (start < end && lines[start].trim() === "") {
    start++;
  }
  while (end > start && lines[end - 1].trim() === "") {
    end--;
  }

  return lines.slice(start, end).join("\n");
}

/**
 * Extracts the latest assistant message from a candidates array.
 * Prefers the last assistant with non-empty cleaned text.
 * When all have empty text, returns the last assistant by index.
 * @param {Array<object>} candidates
 * @returns {object|null}
 */
function extractLatestAssistantSnapshot(candidates) {
  if (!Array.isArray(candidates)) {
    return null;
  }
  let lastNonEmpty = null;
  let lastNonEmptyIdx = -1;
  let lastAssistant = null;
  let lastAssistantIdx = -1;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.isAssistant || c.role === "assistant" || c.turn === "assistant") {
      const cleanedText = cleanChatGPTResponseText(c.text || "");
      lastAssistant = { ...c, _cleanedText: cleanedText };
      lastAssistantIdx = i;
      if (cleanedText.trim().length > 0) {
        lastNonEmpty = lastAssistant;
        lastNonEmptyIdx = i;
      }
    }
  }
  const best = lastNonEmpty !== null ? lastNonEmpty : lastAssistant;
  const bestIdx = lastNonEmpty !== null ? lastNonEmptyIdx : lastAssistantIdx;
  if (!best) {
    return null;
  }
  const result = {
    role: "assistant",
    turn: best.turn || "assistant",
    isAssistant: true,
    text: best._cleanedText,
    messageId: best.messageId || null,
    turnIndex: bestIdx,
  };
  if (best.hasFinishedActions) {
    result.hasFinishedActions = true;
  }
  return result;
}

/**
 * Normalizes a ChatGPT model choice string to canonical form.
 * @param {string} model
 * @returns {string}
 */
function normalizeChatGPTModelChoice(model) {
  if (!model) {
    return "";
  }
  const s = model.toLowerCase().replace(/\s+/g, "").replace(/-/g, "");
  if (s === "instant" || s === "gpt53" || s === "gpt-5-3") {
    return "instant";
  }
  if (s === "thinking" || s === "gpt54thinking" || s === "gpt-5-4-thinking") {
    return "thinking";
  }
  if (s === "pro" || s === "gpt54pro" || s === "gpt-5-4-pro") {
    return "pro";
  }
  // Fallback: strip non-alphanumeric
  return model.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Determines whether the latest assistant content is new vs baseline.
 * Checks messageId, text, and turnIndex — a different turnIndex always means new content.
 * @param {object} latestAssistant
 * @param {object} baselineAssistant
 * @param {number} assistantCount
 * @param {number} baselineAssistantCount
 * @returns {boolean}
 */
function isNewAssistantContent(
  latestAssistant,
  baselineAssistant,
  _assistantCount,
  _baselineAssistantCount,
) {
  if (!latestAssistant) {
    return false;
  }
  if (!baselineAssistant) {
    return true;
  }
  if (latestAssistant.messageId !== baselineAssistant.messageId) {
    return true;
  }
  if (latestAssistant.turnIndex !== baselineAssistant.turnIndex) {
    return true;
  }
  const text1 = (latestAssistant.text || "").trim();
  const text2 = (baselineAssistant.text || "").trim();
  return text1 !== text2;
}

/**
 * Determines whether a ChatGPT response is complete.
 * @param {object} snapshot - { text, stopVisible, hasFinishedActions }
 * @param {number} minStableCycles
 * @param {number} minStableMs
 * @returns {boolean}
 */
function isChatGPTResponseComplete(snapshot, minStableCycles, minStableMs) {
  if (!snapshot) {
    return false;
  }
  if (snapshot.stopVisible) {
    return false;
  }
  // Empty text is never complete, even if finished actions are visible
  const text = (snapshot.text || "").trim();
  if (!text) {
    return false;
  }
  if (snapshot.hasFinishedActions) {
    return true;
  }
  // Not finished: check stability thresholds
  if (typeof minStableCycles === "number" && minStableCycles < 6) {
    return false;
  }
  if (typeof minStableMs === "number" && minStableMs < 1200) {
    return false;
  }
  return true;
}

/**
 * Resolves a model choice string to a ChatGPT model menu option object.
 * @param {Array<{role?: string, label?: string, testId?: string}>} options
 * @param {string} modelChoice
 * @returns {object|null}
 */
function resolveChatGPTModelMenuOption(options, modelChoice) {
  if (!Array.isArray(options) || !modelChoice) {
    return null;
  }
  const normalizedChoice = normalizeChatGPTModelChoice(modelChoice);
  for (const opt of options) {
    if (opt.role === null || opt.role === "menuitem") {
      continue; // skip section labels
    }
    const normalizedLabel = normalizeChatGPTModelChoice(opt.label || "");
    const normalizedTestId = opt.testId
      ? opt.testId
          .replace(/^model-switcher-/g, "")
          .toLowerCase()
          .replace(/-/g, "")
      : "";
    if (normalizedLabel === normalizedChoice || normalizedTestId === normalizedChoice) {
      return { role: opt.role, label: opt.label, testId: opt.testId };
    }
  }
  return null;
}

module.exports = {
  query,
  hasRequiredCookies,
  CHATGPT_URL,
  cleanChatGPTResponseText,
  extractLatestAssistantSnapshot,
  normalizeChatGPTModelChoice,
  resolveChatGPTModelMenuOption,
  isNewAssistantContent,
  isChatGPTResponseComplete,
};
