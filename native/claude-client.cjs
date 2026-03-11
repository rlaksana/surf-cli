/**
 * Claude Web Client for surf-cli
 *
 * CDP-based client for claude.ai using browser automation.
 * Similar approach to the ChatGPT client.
 */

const CLAUDE_URL = "https://claude.ai/";

const SELECTORS = {
  promptTextarea: 'textarea[placeholder*="How can I help you"], textarea[placeholder*="message"], #composer-input, [data-testid="composer-input"], div[contenteditable="true"][role="textbox"]',
  sendButton: 'button[aria-label="Send message"], button[data-testid="send-button"], button[type="submit"]',
  assistantMessage: '[data-is-streaming="false"], .font-claude-response, [data-turn-author="assistant"]',
  stopButton: '[data-testid="stop-button"], button[aria-label="Stop"]',
  conversationTurn: '[data-is-streaming="false"], .font-claude-response, [data-turn-author="assistant"]',
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
  if (!cookies || !Array.isArray(cookies)) return false;
  // Check for session-related cookies (sessionKey, any session cookie)
  // or device ID cookies that indicate authenticated session
  const validCookie = cookies.find(
    (c) => c.value && (
      c.name.includes("session") ||
      c.name === "anthropic-device-id" ||
      c.name === "ARID"
    )
  );
  return Boolean(validCookie);
}

async function evaluate(cdp, expression) {
  const result = await cdp(expression);
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description ||
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

async function checkLoginStatus(cdp) {
  const result = await evaluate(cdp, `(() => {
    const buttons = Array.from(document.querySelectorAll('button, a'));
    const hasSignIn = buttons.some(b => {
      const text = (b.textContent || '').toLowerCase().trim();
      return text === 'sign in' || text === 'log in' || text.includes('sign in');
    });
    const hasAccount = buttons.some(b => {
      const text = (b.textContent || '').toLowerCase();
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      return text.includes('account') || label.includes('account') || label.includes('profile');
    });
    return {
      loggedIn: hasAccount || !hasSignIn,
      hasSignIn
    };
  })()`);
  return result || { loggedIn: false };
}

async function waitForPromptReady(cdp, timeoutMs = 20000) {
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
      })()`
    );
    if (found) return true;
    await delay(200);
  }
  return false;
}

async function typePrompt(cdp, inputCdp, prompt) {
  const selectors = SELECTORS.promptTextarea.split(", ");
  const textarea = await evaluate(
    cdp,
    `(() => {
      const selectors = ${JSON.stringify(selectors)};
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node) return selector;
      }
      return null;
    })()`
  );

  if (!textarea) {
    throw new Error("Prompt input not found");
  }

  // Use JavaScript to type (more reliable)
  await evaluate(
    cdp,
    `(() => {
      const selectors = ${JSON.stringify(selectors)};
      const node = document.querySelector(selectors[0]);
      if (!node) return false;

      // Clear existing content
      node.value = '';

      // Focus the input
      node.focus();

      return true;
    })()`
  );

  // Type the prompt
  await inputCdp("Input.insertText", { text: prompt });

  // Small delay after typing
  await delay(100);
}

async function clickSend(cdp, inputCdp) {
  // Try multiple methods to click send
  const clicked = await evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const selectors = ${JSON.stringify(SELECTORS.sendButton.split(", "))};
      for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn) {
          dispatchClickSequence(btn);
          return true;
        }
      }
      return false;
    })()`
  );

  if (!clicked) {
    // Fallback: try pressing Enter
    await inputCdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      text: "\r"
    });
    await inputCdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      text: "\r"
    });
  }

  await delay(500);
}

async function waitForResponse(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastContent = "";
  let stableCount = 0;

  while (Date.now() < deadline) {
    // Check if stop button is gone (generation complete)
    const isGenerating = await evaluate(
      cdp,
      `(() => {
        const selectors = ${JSON.stringify(SELECTORS.stopButton.split(", "))};
        for (const selector of selectors) {
          if (document.querySelector(selector)) return true;
        }
        return false;
      })()`
    );

    if (!isGenerating) {
      // Wait a bit more for final content
      await delay(1000);

      const content = await getAssistantContent(cdp);
      if (content && content !== lastContent) {
        lastContent = content;
        stableCount = 0;
      } else if (content && content === lastContent) {
        stableCount++;
        if (stableCount >= 3) {
          return { text: content };
        }
      }
    }

    await delay(500);
  }

  // Timeout - return what we have
  const content = await getAssistantContent(cdp);
  return { text: content || "Response timeout" };
}

async function getAssistantContent(cdp) {
  const result = await evaluate(
    cdp,
    `(() => {
      const selectors = ${JSON.stringify(SELECTORS.conversationTurn.split(", "))};
      let content = "";

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          const lastEl = elements[elements.length - 1];
          // Clone and remove feedback buttons and other UI elements
          const clone = lastEl.cloneNode(true);
          const removeSelectors = [
            'button', '[role="button"]', '.feedback',
            '[data-testid="feedback"]', '.thumbs-up', '.thumbs-down',
            'div[aria-label="Good response"]', 'div[aria-label="Bad response"]'
          ];
          removeSelectors.forEach(sel => {
            clone.querySelectorAll(sel).forEach(el => el.remove());
          });
          content = clone.textContent || "";
          break;
        }
      }

      return content.trim();
    })()`
  );

  return result || "";
}

async function query(options) {
  const {
    prompt: originalPrompt,
    model,
    timeout = 300000,
    getCookies,
    createTab,
    closeTab,
    cdpEvaluate,
    cdpCommand,
    log = () => {},
  } = options;

  const prompt = originalPrompt;
  const startTime = Date.now();
  log("Starting Claude.ai query");

  const { cookies } = await getCookies();
  const cookieNames = cookies?.map(c => c.name) || [];
  if (!hasRequiredCookies(cookies)) {
    throw new Error(`Claude.ai login required. Found ${cookies?.length || 0} cookies: ${cookieNames.join(", ")}`);
  }
  log(`Got ${cookies.length} cookies`);

  const tabInfo = await createTab();
  const { tabId } = tabInfo;
  if (!tabId) {
    throw new Error("Failed to create Claude.ai tab");
  }
  log(`Created tab ${tabId}`);

  const cdp = (expr) => cdpEvaluate(tabId, expr);
  const inputCdp = (method, params) => cdpCommand(tabId, method, params);

  try {
    await waitForPageLoad(cdp);
    log("Page loaded");

    const loginStatus = await checkLoginStatus(cdp);
    log(`DEBUG loginStatus: ${JSON.stringify(loginStatus)}`);
    if (!loginStatus.loggedIn) {
      throw new Error(`Claude.ai login required. Status: ${JSON.stringify(loginStatus)}`);
    }
    log("Login verified");

    const promptReady = await waitForPromptReady(cdp);
    if (!promptReady) {
      throw new Error("Prompt textarea not ready");
    }
    log("Prompt ready");

    await typePrompt(cdp, inputCdp, prompt);
    log("Prompt typed");

    await clickSend(cdp, inputCdp);
    log("Prompt sent, waiting for response...");

    const response = await waitForResponse(cdp, timeout);
    log(`Response received (${response.text.length} chars)`);

    return {
      response: response.text,
      model: model || "claude-3-5-sonnet",
      tookMs: Date.now() - startTime,
    };
  } finally {
    await closeTab(tabId).catch(() => {});
  }
}

module.exports = { query, hasRequiredCookies, CLAUDE_URL };
