/**
 * AI Mode (Google) Client for surf-cli
 *
 * CDP-based client for Google search with AI mode (udm=50=auto, nem=143=pro).
 * Uses browser automation to interact with Google's AI search.
 */

const AIMODE_URL_AUTO = "https://www.google.com/search?udm=50&q=";
const AIMODE_URL_PRO = "https://www.google.com/search?nem=143&q=";

const SELECTORS = {
  searchInput: 'textarea[name="q"], input[name="q"], input[aria-label="Search"]',
  resultContainer: '#main, [role="main"], .GybnWb, . Response-container',
  answer: '.X7NTVe, .的气, [data-initq], .reply-content, .AdD1h',
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
  // Check for Google session cookies
  const hasSession = cookies.some(c =>
    c.name.includes('SID') ||
    c.name.includes('HSID') ||
    c.name === '__Secure-1PAPISID' ||
    c.name === '__Secure-1PSID'
  );
  return hasSession || cookies.length > 0;
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

async function waitForPageLoad(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.readyState");
    if (ready === "complete" || ready === "interactive") {
      await delay(500);
      return;
    }
    await delay(100);
  }
  throw new Error("Page did not load in time");
}

async function waitForSearchBox(cdp, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const selectors = JSON.stringify(SELECTORS.searchInput.split(", "));
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

async function typeQuery(cdp, inputCdp, query) {
  const selectors = SELECTORS.searchInput.split(", ");

  // Click on search box first
  await evaluate(
    cdp,
    `(() => {
      const selectors = ${JSON.stringify(selectors)};
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node) {
          node.focus();
          return true;
        }
      }
      return false;
    })()`
  );

  await delay(200);

  // Type the query
  await inputCdp("Input.insertText", { text: query });

  await delay(100);
}

async function pressEnter(cdp, inputCdp) {
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

async function waitForResponse(cdp, timeoutMs, log = () => {}) {
  const deadline = Date.now() + timeoutMs;
  let lastContent = "";
  let stableCount = 0;
  let checkCount = 0;

  while (Date.now() < deadline) {
    await delay(1000);
    checkCount++;

    const content = await getAnswerContent(cdp, log);
    log(`Check ${checkCount}: content length = ${content?.length || 0}`);

    if (content && content !== lastContent) {
      lastContent = content;
      stableCount = 0;
      log(`  -> New content found, length: ${content.length}`);
    } else if (content && content === lastContent) {
      stableCount++;
      log(`  -> Stable count: ${stableCount}`);
      if (stableCount >= 3) {
        return { text: content };
      }
    } else {
      // Check if we're still loading
      const isLoading = await evaluate(
        cdp,
        `(() => {
          const spinner = document.querySelector('.pRzye, .l4cyt, [role="progressbar"]');
          return spinner !== null;
        })()`
      );
      log(`  -> Loading: ${isLoading}, lastContent length: ${lastContent.length}`);
      if (!isLoading && lastContent) {
        return { text: lastContent };
      }
    }
  }

  // Timeout - return what we have
  const content = await getAnswerContent(cdp);
  log(`Final content length: ${content?.length || 0}`);
  return { text: content || "Response timeout" };
}

async function getAnswerContent(cdp, log = () => {}) {
  try {
    const debugInfo = await evaluate(
      cdp,
      `(() => {
        const info = {
          readyState: document.readyState,
          url: window.location.href,
          aimfl: null,
          aimc: null,
          main: null,
          bodyLength: document.body.textContent.length,
          bodyPreview: document.body.textContent.substring(0, 200)
        };
        try { info.aimfl = document.querySelector('[data-subtree="aimfl"]')?.textContent?.substring(0, 100); } catch(e) {}
        try { info.aimc = document.querySelector('[data-subtree="aimc"]')?.textContent?.substring(0, 100); } catch(e) {}
        try { info.main = document.querySelector('main')?.textContent?.substring(0, 100); } catch(e) {}
        return info;
      })()`
    );
    log(`Debug: ${JSON.stringify(debugInfo)}`);

    const result = await evaluate(
      cdp,
      `(() => {
        // Primary: Try data-subtree="aimc" - AI response with UI elements (FULL response)
        const aimc = document.querySelector('[data-subtree="aimc"]');
        if (aimc) {
          const text = aimc.textContent.trim();
          // Extract just the response before "AI responses may include mistakes"
          const idx = text.indexOf('AI responses may include mistakes');
          if (idx > 0) {
            return text.substring(0, idx).trim();
          }
          return text;
        }

        // Secondary: Try data-subtree="aimfl" - clean AI response text (shorter)
        const aimfl = document.querySelector('[data-subtree="aimfl"]');
        if (aimfl) {
          const text = aimfl.textContent.trim();
          if (text.length > 0) return text;
        }

        // Fallback: legacy selectors
        const legacySelectors = ['.X7NTVe', '.GybnWb', '.reply-content', '.AdD1h'];
        for (const selector of legacySelectors) {
          const el = document.querySelector(selector);
          if (el) {
            return el.textContent.trim();
          }
        }

        // Check for any element containing significant text
        const main = document.querySelector('main, #main, [role="main"]');
        if (main && main.textContent.length > 100) {
          return main.textContent.trim().substring(0, 3000);
        }

        // Last resort: body text cleaned
        return document.body.textContent.trim().replace(/\\s+/g, ' ').substring(0, 3000);
      })()`
    );

    return result || "";
  } catch (err) {
    log(`Error in getAnswerContent: ${err.message}`);
    // If evaluation fails, return empty to trigger fallback
    return "";
  }
}

async function query(options) {
  const {
    prompt: query,
    pro = false,
    timeout = 120000,
    getCookies,
    createTab,
    closeTab,
    cdpEvaluate,
    cdpCommand,
    log = () => {},
  } = options;

  const searchUrl = pro ? AIMODE_URL_PRO : AIMODE_URL_AUTO;
  const startTime = Date.now();
  const debugLog = (msg) => {
    console.error(`[AIMODE DEBUG] ${msg}`);
    log(msg);
  };

  debugLog("Starting aimode query");

  const { cookies } = await getCookies();
  const cookieNames = cookies?.map(c => c.name) || [];
  if (!hasRequiredCookies(cookies)) {
    debugLog(`Warning: No Google cookies found. Found: ${cookieNames.join(", ")}`);
  }
  debugLog(`Got ${cookies.length} cookies`);

  // For aimode, we'll navigate directly to the search URL instead of using CDP
  // This avoids issues with tab creation timing
  const fullSearchUrl = searchUrl + encodeURIComponent(query);
  debugLog(`Will navigate to: ${fullSearchUrl}`);

  // Create a basic tab info - we'll use CDP navigate instead
  const tabInfo = await createTab();
  const { tabId } = tabInfo;
  if (!tabId) {
    throw new Error("Failed to create tab");
  }
  debugLog(`Created tab ${tabId}`);

  const cdp = (expr) => cdpEvaluate(tabId, expr);
  const inputCdp = (method, params) => cdpCommand(tabId, method, params);

  try {
    // Wait for tab to be ready
    await delay(2000);

    // Navigate to Google search with the query
    debugLog(`Navigating to: ${fullSearchUrl}`);

    // Navigate using CDP
    await cdp(`window.location.href = "${fullSearchUrl}"`);

    await waitForPageLoad(cdp);
    debugLog("Page loaded");

    // Wait for AI to finish thinking/loading
    debugLog("Waiting for AI thinking to complete...");
    const deadline = Date.now() + 60000; // max 60s wait
    let thinking = true;

    while (thinking && Date.now() < deadline) {
      const status = await evaluate(
        cdp,
        `(() => {
          // Check if thinking/loading element exists
          const loading = document.querySelector('.qewEec, [jsuid*="Creating layout"]');
          const hasAI = document.querySelector('[data-subtree="aimc"]') !== null ||
                        document.querySelector('[data-subtree="aimfl"]') !== null;
          return { loading: loading !== null, hasAI: hasAI };
        })()`
      );
      debugLog(`Status: loading=${status.loading}, hasAI=${status.hasAI}`);

      if (status.hasAI) {
        thinking = false;
        debugLog("AI response detected!");
      } else if (!status.loading) {
        // No loading, but no AI - might be no response available
        debugLog("No loading, checking if AI will respond...");
        await delay(2000);
        const retryStatus = await evaluate(
          cdp,
          `(() => document.querySelector('[data-subtree="aimc"]') !== null ||
                    document.querySelector('[data-subtree="aimfl"]') !== null)`
        );
        if (!retryStatus) {
          debugLog("No AI response available");
          break;
        }
        thinking = false;
      } else {
        await delay(2000);
      }
    }

    // Get response content
    const response = await waitForResponse(cdp, timeout, debugLog);
    debugLog(`Response received (${response.text.length} chars)`);

    return {
      response: response.text,
      url: fullSearchUrl,
      tookMs: Date.now() - startTime,
    };
  } finally {
    await closeTab(tabId).catch(() => {});
  }
}

module.exports = { query, hasRequiredCookies };
