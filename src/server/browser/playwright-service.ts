import path from "node:path";
import fs from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";

const GEMINI_URL = "https://gemini.google.com/app";
const DEFAULT_USER_DATA_DIR = path.resolve(process.cwd(), "storage", "browser-data");

/** How long to wait for the new image to fully appear after sending (ms). */
const IMAGE_GENERATION_TIMEOUT_MS = 180_000; // 3 minutes
/** How long to wait for Gemini's input / send button to be ready (ms). */
const UI_READY_TIMEOUT_MS = 30_000;

let activeContext: BrowserContext | null = null;

export interface BrowserStatus {
  ready: boolean;
  executablePath: string | null;
  userDataDir: string;
  hasActiveSession: boolean;
  error?: string;
}

async function findSystemChrome(): Promise<string | null> {
  const candidates = [
    process.env["PROGRAMFILES"] &&
      path.join(process.env["PROGRAMFILES"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env["ProgramFiles(x86)"] &&
      path.join(process.env["ProgramFiles(x86)"]!, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["LOCALAPPDATA"] &&
      path.join(process.env["LOCALAPPDATA"]!, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // not found, try next
    }
  }
  return null;
}

export async function getPlaywrightBrowserStatus(): Promise<BrowserStatus> {
  const userDataDir = process.env.PINLENS_BROWSER_DIR || DEFAULT_USER_DATA_DIR;
  try {
    await fs.mkdir(userDataDir, { recursive: true });
    const executablePath = await findSystemChrome();
    const hasActiveSession = activeContext !== null && activeContext.pages().length > 0;
    return {
      ready: true,
      executablePath: executablePath ?? chromium.executablePath(),
      userDataDir,
      hasActiveSession,
    };
  } catch (error) {
    return {
      ready: false,
      executablePath: null,
      userDataDir,
      hasActiveSession: false,
      error: error instanceof Error ? error.message : "Browser automation unavailable.",
    };
  }
}

/** Launch (or reuse) a persistent Chrome context. */
async function ensureContext(): Promise<BrowserContext> {
  if (activeContext) {
    try {
      activeContext.pages();
      return activeContext;
    } catch {
      activeContext = null;
    }
  }

  const userDataDir = process.env.PINLENS_BROWSER_DIR || DEFAULT_USER_DATA_DIR;
  await fs.mkdir(userDataDir, { recursive: true });

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: false,
      viewport: null,
      args: [
        "--start-maximized",
        "--disable-infobars",
        "--disable-blink-features=AutomationControlled",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    activeContext = context;
    context.once("close", () => {
      if (activeContext === context) activeContext = null;
    });
    return context;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("lock") || msg.includes("user data directory is already in use")) {
      throw new Error(
        "The browser profile is locked. Close other Chrome windows using this profile and retry.",
      );
    }
    console.warn("System Chrome not found, falling back to bundled Chromium.");
    const context = await chromium.launchPersistentContext(
      process.env.PINLENS_BROWSER_DIR || DEFAULT_USER_DATA_DIR,
      {
        headless: false,
        viewport: null,
        args: ["--start-maximized"],
      },
    );
    activeContext = context;
    context.once("close", () => {
      if (activeContext === context) activeContext = null;
    });
    return context;
  }
}

/** Get the existing Gemini page or create a new one. */
async function getGeminiPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  const existing = pages.find((p) => p.url().includes("gemini.google.com"));
  if (existing) {
    await existing.bringToFront();
    return existing;
  }
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return page;
}

/** Type the prompt into Gemini's input box using multiple selector fallbacks. */
async function typePromptIntoGemini(page: Page, prompt: string): Promise<void> {
  const inputSelectors = [
    "rich-textarea div[contenteditable='true']",
    "div.ql-editor[contenteditable='true']",
    "div[contenteditable='true'][data-placeholder]",
    "div[contenteditable='true']",
    "textarea",
  ];

  let inputHandle = null;
  for (const selector of inputSelectors) {
    try {
      inputHandle = await page.waitForSelector(selector, {
        state: "visible",
        timeout: UI_READY_TIMEOUT_MS,
      });
      if (inputHandle) break;
    } catch {
      // try next selector
    }
  }

  if (!inputHandle) {
    throw new Error(
      "Could not find Gemini's input box. Make sure you are signed into Google in the browser window.",
    );
  }

  await inputHandle.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await inputHandle.fill(prompt);
}

/** Click the send button using multiple selector fallbacks. */
async function clickSendButton(page: Page): Promise<void> {
  const sendSelectors = [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    'button[data-mat-icon-name="send"]',
    'button.send-button',
    'button[jsname="Qx7uuf"]',
    'button:has(mat-icon:text("send"))',
    'button:has([data-mat-icon-name="send"])',
  ];

  for (const selector of sendSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        const isDisabled = await btn.isDisabled();
        if (!isDisabled) {
          await btn.click();
          return;
        }
      }
    } catch {
      // try next
    }
  }

  await page.keyboard.press("Enter");
}

/**
 * Finds the currently bottom-most generated image in the chat.
 */
async function getBottomMostImage(
  page: Page,
): Promise<{ src: string; count: number } | null> {
  return await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img")).filter((img) => {
      return (
        img.complete &&
        img.naturalWidth >= 200 &&
        img.naturalHeight >= 200 &&
        img.src &&
        !img.src.startsWith("data:image/svg") &&
        !img.src.includes("icon") &&
        !img.src.includes("avatar") &&
        !img.src.includes("spinner") &&
        !img.src.includes("loading")
      );
    });

    if (imgs.length === 0) return null;

    imgs.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return (rectA.top + window.scrollY) - (rectB.top + window.scrollY);
    });

    const bottom = imgs[imgs.length - 1];
    return { src: bottom.src, count: imgs.length };
  });
}

/**
 * Wait for Gemini to finish generating the NEW bottom-most image, and download ONLY that image.
 */
async function waitForAndDownloadBottomImage(
  page: Page,
  previousState: { src: string; count: number } | null,
): Promise<Buffer> {
  const prevSrc = previousState?.src ?? null;
  const prevCount = previousState?.count ?? 0;

  // 1. Wait until a new bottom-most image is generated
  const bottomSrcHandle = await page.waitForFunction(
    ({ oldSrc, oldCount }) => {
      window.scrollTo(0, document.body.scrollHeight);

      const imgs = Array.from(document.querySelectorAll("img")).filter((img) => {
        return (
          img.complete &&
          img.naturalWidth >= 200 &&
          img.naturalHeight >= 200 &&
          img.src &&
          !img.src.startsWith("data:image/svg") &&
          !img.src.includes("icon") &&
          !img.src.includes("avatar") &&
          !img.src.includes("spinner") &&
          !img.src.includes("loading")
        );
      });

      if (imgs.length === 0) return null;

      // Sort strictly by vertical page coordinate (top to bottom)
      imgs.sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return (rectA.top + window.scrollY) - (rectB.top + window.scrollY);
      });

      const bottom = imgs[imgs.length - 1];

      // Must be a new image: either image count increased, or bottom src changed
      if (oldSrc && bottom.src === oldSrc && imgs.length <= oldCount) {
        return null;
      }

      return bottom.src;
    },
    { oldSrc: prevSrc, oldCount: prevCount },
    { timeout: IMAGE_GENERATION_TIMEOUT_MS, polling: 1500 },
  );

  const bottomImageSrc = await bottomSrcHandle.jsonValue();
  if (!bottomImageSrc || typeof bottomImageSrc !== "string") {
    throw new Error("Gemini did not produce a new image within the timeout period.");
  }

  // 2. Wait 2 seconds for generation to settle and render fully
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  // 3. Primary strategy: Direct server-side fetch of the bottom-most image's exact URL
  // This guarantees we download ONLY the bottom-most image and avoids any UI button ambiguity!
  if (bottomImageSrc.startsWith("http://") || bottomImageSrc.startsWith("https://")) {
    try {
      const apiResponse = await page.request.get(bottomImageSrc, {
        headers: {
          Referer: "https://gemini.google.com/",
        },
      });
      if (apiResponse.ok()) {
        const body = await apiResponse.body();
        if (body.length > 1000) return body;
      }
    } catch {
      // Try Node.js fetch fallback
    }

    try {
      const nodeResponse = await fetch(bottomImageSrc, {
        headers: {
          "User-Agent": await page.evaluate(() => navigator.userAgent),
          Referer: "https://gemini.google.com/",
        },
      });
      if (nodeResponse.ok) {
        const buffer = Buffer.from(await nodeResponse.arrayBuffer());
        if (buffer.length > 1000) return buffer;
      }
    } catch {
      // Try next strategy
    }
  }

  // 4. Secondary strategy: Click the LAST download button in the document (the bottom-most one)
  try {
    const downloadButtons = await page.$$(
      'button[aria-label*="Download" i], button[title*="Download" i], a[download]'
    );
    if (downloadButtons.length > 0) {
      // Pick the LAST download button in document order (corresponds to the bottom-most message)
      const lastButton = downloadButtons[downloadButtons.length - 1];
      await lastButton.scrollIntoViewIfNeeded().catch(() => {});
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 8000 }),
        lastButton.click().catch(() => {}),
      ]);
      const downloadPath = await download.path();
      if (downloadPath) {
        const fileBytes = await fs.readFile(downloadPath);
        if (fileBytes.length > 1000) return fileBytes;
      }
    }
  } catch {
    // Proceed to data / blob extraction
  }

  // 5. Strategy C: Base64 data URL
  if (bottomImageSrc.startsWith("data:")) {
    const base64Data = bottomImageSrc.split(",")[1];
    if (base64Data) return Buffer.from(base64Data, "base64");
  }

  // 6. Strategy D: Blob URL conversion inside browser
  if (bottomImageSrc.startsWith("blob:")) {
    try {
      const base64 = await page.evaluate(async (blobUrl: string) => {
        const res = await fetch(blobUrl);
        const blob = await res.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }, bottomImageSrc);
      if (base64) return Buffer.from(base64, "base64");
    } catch {
      // Fall through to screenshot
    }
  }

  // 7. Strategy E: Element screenshot of the bottom-most image element
  try {
    const imgHandles = await page.$$("img");
    let bottomHandle = null;
    let maxY = -Infinity;
    for (const handle of imgHandles) {
      const box = await handle.boundingBox();
      if (box && box.width >= 200 && box.height >= 200 && box.y > maxY) {
        maxY = box.y;
        bottomHandle = handle;
      }
    }
    if (bottomHandle) {
      const screenshot = await bottomHandle.screenshot({ type: "png" });
      if (screenshot.length > 1000) return screenshot;
    }
  } catch {
    // throw below
  }

  throw new Error("The bottom-most image was generated in Gemini but could not be downloaded.");
}

/**
 * Full end-to-end:
 * 1. Snapshots the bottom-most image in the chat before sending.
 * 2. Types and sends the new prompt.
 * 3. Waits specifically for a NEW bottom-most image to be generated.
 * 4. Downloads and returns only the newly generated bottom-most image.
 */
export async function generateImageWithGemini(prompt: string): Promise<Buffer> {
  const context = await ensureContext();
  const page = await getGeminiPage(context);

  if (!page.url().includes("gemini.google.com")) {
    await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  // 1. Snapshot the bottom-most image state BEFORE sending the prompt
  const previousState = await getBottomMostImage(page);

  // 2. Type prompt into Gemini's input
  await typePromptIntoGemini(page, prompt);
  await page.waitForTimeout(600);

  // 3. Send the prompt
  await clickSendButton(page);

  // 4. Wait 2 seconds for Gemini to register the message and begin generating
  await page.waitForTimeout(2000);

  // 5. Wait specifically for the NEW bottom-most image and download ONLY it
  return await waitForAndDownloadBottomImage(page, previousState);
}

/** Open Gemini in Chrome without full automation (for manual use). */
export async function openGeminiBrowser(options?: {
  url?: string;
  prompt?: string;
}): Promise<{ opened: boolean; url: string; hasPrompt: boolean }> {
  const targetUrl = options?.url || GEMINI_URL;
  const context = await ensureContext();
  const page = await getGeminiPage(context);
  if (!page.url().includes("gemini.google.com")) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
  }
  if (options?.prompt) {
    try {
      await typePromptIntoGemini(page, options.prompt);
    } catch {
      // best-effort
    }
  }
  return { opened: true, url: targetUrl, hasPrompt: Boolean(options?.prompt) };
}

export async function closeGeminiBrowser(): Promise<void> {
  if (activeContext) {
    try {
      await activeContext.close();
    } catch {
      // ignore
    } finally {
      activeContext = null;
    }
  }
}
