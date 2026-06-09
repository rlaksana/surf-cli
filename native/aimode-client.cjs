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
  answer: ".X7NTVe, .的气, [data-initq], .reply-content, .AdD1h",
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _buildClickDispatcher() {
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
  // Check for Google session cookies
  const hasSession = cookies.some(
    (c) =>
      c.name.includes("SID") ||
      c.name.includes("HSID") ||
      c.name === "__Secure-1PAPISID" ||
      c.name === "__Secure-1PSID",
  );
  return hasSession || cookies.length > 0;
}

async function evaluate(cdp, expression) {
  const result = await cdp(expression);
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

async function _waitForSearchBox(cdp, timeoutMs = 15000) {
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
      })()`,
    );
    if (found) {
      return true;
    }
    await delay(200);
  }
  return false;
}

async function _typeQuery(cdp, inputCdp, query) {
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
    })()`,
  );

  await delay(200);

  // Type the query
  await inputCdp("Input.insertText", { text: query });

  await delay(100);
}

async function _pressEnter(_cdp, inputCdp) {
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    text: "\r",
  });
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    text: "\r",
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
        })()`,
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
      })()`,
    );
    log(`Debug: ${JSON.stringify(debugInfo)}`);

    const result = await evaluate(
      cdp,
      `(() => {
        // Try aimc first - it contains the full response text.
        // [data-subtree="aimfl"] is an INNER element (e.g. first token /
        // header) that may contain only a fragment of the response. Using
        // it as the primary selector truncated long answers to their first
        // item (e.g. "Apple" for a 5-fruit list).
        const aimc = document.querySelector('[data-subtree="aimc"]');
        if (aimc) {
          // Get just the paragraphs, not the UI
          const paras = aimc.querySelectorAll('p');
          if (paras.length > 0) {
            return Array.from(paras).map(p => p.textContent.trim()).join('\\n');
          }
          // Fallback: get text content but clean it
          const text = aimc.textContent.trim();
          const copyIdx = text.indexOf('CopyShare');
          if (copyIdx > 0) return text.substring(0, copyIdx).trim();
          return text;
        }

        // Fallback: legacy selectors for AI answer
        const legacySelectors = ['.X7NTVe', '.GybnWb', '.reply-content', '.AdD1h'];
        for (const selector of legacySelectors) {
          const el = document.querySelector(selector);
          if (el) return el.textContent.trim();
        }

        // Last resort: aimfl. Only used if aimc and legacy selectors
        // both miss. May return a partial response.
        const aimfl = document.querySelector('[data-subtree="aimfl"]');
        if (aimfl) {
          const text = aimfl.textContent.trim();
          if (text.length > 0) return text;
        }

        return '';
      })()`,
    );

    return cleanResponse(result || "");
  } catch (err) {
    log(`Error in getAnswerContent: ${err.message}`);
    // If evaluation fails, return empty to trigger fallback
    return "";
  }
}

function cleanResponse(text) {
  if (!text) return "";

  // Find where the UI elements start and cut there
  const uiMarkers = ['CopyShare', 'This public link is valid', 'Creating a public link'];
  let cutIdx = text.length;

  for (const marker of uiMarkers) {
    const idx = text.indexOf(marker);
    if (idx > 0 && idx < cutIdx) {
      cutIdx = idx;
    }
  }

  let cleaned = text.substring(0, cutIdx);

  // Remove source citations like "[+3]"
  cleaned = cleaned.replace(/\s*\[\+\d+\]/g, "");
  // Remove "(Source +1)" style citations
  cleaned = cleaned.replace(/\s*\([A-Za-z0-9\s]+\s*\+\d+\)/g, "");
  // Remove "X sites" at the end
  cleaned = cleaned.replace(/\n\d+\s+sites\s*$/gim, "");
  // Clean up multiple newlines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
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
    log(msg);
  };

  debugLog("Starting aimode query");

  const { cookies } = await getCookies();
  const cookieNames = cookies?.map((c) => c.name) || [];
  if (!hasRequiredCookies(cookies)) {
    debugLog(`Warning: No Google cookies found. Found: ${cookieNames.join(", ")}`);
  }
  debugLog(`Got ${cookies.length} cookies`);

  // Create tab - AIMODE_NEW_TAB handler creates a neutral window and
  // navigates to the search URL via CDP Page.navigate (bypasses Chrome interception)
  const fullSearchUrl = searchUrl + encodeURIComponent(query);
  debugLog(`Will navigate to: ${fullSearchUrl}`);

  const tabInfo = await createTab(fullSearchUrl);
  const { tabId } = tabInfo;
  if (!tabId) {
    throw new Error("Failed to create tab: " + (tabInfo.error || JSON.stringify(tabInfo)));
  }
  debugLog(`Created tab ${tabId}`);

  const cdp = (expr) => cdpEvaluate(tabId, expr);
  const _inputCdp = (method, params) => cdpCommand(tabId, method, params);

  try {
    // Wait for Page.navigate (issued by service worker) to complete
    debugLog("Waiting for page to load after CDP navigation...");
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
        })()`,
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
                    document.querySelector('[data-subtree="aimfl"]') !== null)`,
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
    if (tabId) {
      await Promise.race([
        closeTab(tabId),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]).catch(() => {});
    }
  }
}

module.exports = { query, hasRequiredCookies };
