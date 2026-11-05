/**
 * Pinterest Headless Pin Uploader.
 *
 * Uses Playwright in headless mode with the account's saved session cookies/tokens
 * to automate uploading pins to Pinterest (title, description, image, link, board).
 */
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { prisma } from "@/lib/prisma";
import { resolveStoragePath } from "@/server/storage/local-storage";
import { ensureSessionStorageFile } from "./browser-session";
import { PinterestAuthError } from "./api-client";

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
      // try next
    }
  }
  return null;
}

export async function publishPinWithHeadlessBrowser(
  jobId: string,
): Promise<{ pinId: string; pinUrl: string }> {
  const job = await prisma.pinterestPublishingJob.findUnique({
    where: { id: jobId },
    include: {
      account: { select: { id: true, username: true, displayName: true } },
      board: { select: { id: true, name: true, pinterestBoardId: true } },
      contentPackage: {
        include: {
          assets: {
            where: { status: "Complete" },
            take: 1,
          },
        },
      },
    },
  });

  if (!job) throw new Error(`Publishing job ${jobId} not found.`);

  const asset = job.contentPackage.assets[0];
  if (!asset) {
    throw new Error("No complete image asset available for this pin.");
  }

  // Resolve absolute path to the WebP image on disk
  const imageAbsolutePath = resolveStoragePath(asset.relativePath);
  await fs.access(imageAbsolutePath);

  // Ensure session state file exists
  const sessionPath = await ensureSessionStorageFile(job.accountId);

  const executablePath = await findSystemChrome();
  const launchOptions: any = {
    headless: true,
    args: [
      "--disable-infobars",
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  };
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else {
    launchOptions.channel = "chrome";
  }

  const browser = await chromium.launch(launchOptions);

  try {
    const context = await browser.newContext({
      storageState: sessionPath,
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    // Listen for Pinterest internal Pin creation response to get exact Pin ID
    let capturedPinId: string | null = null;
    let capturedPinUrl: string | null = null;

    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (
          res.ok() &&
          (url.includes("/resource/ApiResource/create/") ||
            url.includes("/resource/PinResource/create/") ||
            url.includes("/PinResource/create") ||
            url.includes("api.pinterest.com/v3/pins/"))
        ) {
          const json = await res.json();
          const resp = json?.resource_response;
          const data = resp?.data || json?.data;

          // Check for story pin create endpoint
          if (resp?.endpoint_name === "v3_create_story_pin_data" && data?.node_id) {
            const decoded = Buffer.from(String(data.node_id), "base64").toString("utf8");
            const match = decoded.match(/Pin:(\d+)/);
            if (match) {
              capturedPinId = match[1];
              capturedPinUrl = `https://www.pinterest.com/pin/${match[1]}/`;
            }
          } else if (data?.id) {
            capturedPinId = String(data.id);
            capturedPinUrl = data.url || `https://www.pinterest.com/pin/${data.id}/`;
          }
        }
      } catch {}
    });

    // 1. Navigate to Pin Creation Tool
    await page.goto("https://www.pinterest.com/pin-creation-tool/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    // Check if redirected to login
    if (page.url().includes("/login")) {
      throw new PinterestAuthError(
        `Pinterest session expired for @${job.account.username}. Please re-login via Pinterest Accounts.`,
      );
    }

    // Wait for the pin creation editor to mount
    await page.waitForTimeout(3000);

    // 2. Upload image file
    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 25000 });
    await fileInput.setInputFiles(imageAbsolutePath);

    // Give the image a few seconds to upload and render preview
    await page.waitForTimeout(3500);

    // 3. Set Pin Title
    const titleSelectors = [
      '#storyboard-selector-title',
      '[data-test-id="storyboard-title-field-container"] input',
      'textarea[id*="pin-draft-title" i]',
      '[data-test-id="pin-draft-title"] textarea',
      '[data-test-id="pin-draft-title"] input',
      'input[placeholder*="title" i]',
      'textarea[placeholder*="title" i]',
      'input[id*="title" i]',
    ];
    for (const sel of titleSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.fill(job.contentPackage.pinterestTitle);
        break;
      }
    }

    // 4. Set Pin Description (with hashtags for discovery and virality)
    let hashtags: string[] = [];
    if (job.contentPackage.hashtagsJson) {
      try {
        const parsed = JSON.parse(job.contentPackage.hashtagsJson);
        if (Array.isArray(parsed)) {
          hashtags = parsed
            .map((t) => String(t).trim())
            .filter(Boolean)
            .map((t) => (t.startsWith("#") ? t : `#${t}`));
        }
      } catch {}
    }
    const fullDescription =
      hashtags.length > 0
        ? `${job.contentPackage.description}\n\n${hashtags.join(" ")}`
        : job.contentPackage.description;

    const descSelectors = [
      '[data-test-id="storyboard-description-field-container"] .public-DraftEditor-content',
      '[aria-label*="Describe your Pin" i]',
      'div.public-DraftEditor-content',
      '[data-test-id="editor-with-mentions"]',
      'div[data-test-id="pin-draft-description"] div[contenteditable="true"]',
      '[data-test-id="pin-draft-description"] textarea',
      'div[role="textbox"][contenteditable="true"]',
      'textarea[placeholder*="description" i]',
    ];
    for (const sel of descSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await page.waitForTimeout(300);
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.keyboard.insertText(fullDescription);
        break;
      }
    }

    // 5. Set Destination Link
    if (job.contentPackage.destinationUrl) {
      const linkSelectors = [
        '[data-test-id="storyboard-selector-link"] input',
        'input[id*="pin-draft-link" i]',
        '[data-test-id="pin-draft-link"] input',
        'input[placeholder*="link" i]',
      ];
      for (const sel of linkSelectors) {
        const el = await page.$(sel);
        if (el) {
          await el.fill(job.contentPackage.destinationUrl);
          break;
        }
      }
    }

    // 6. Select Board
    const boardDropdownSelectors = [
      '[data-test-id="board-dropdown-select-button"]',
      '[data-test-id="pin-draft-board-select"]',
      'button[aria-label*="board" i]',
    ];
    let boardOpened = false;
    for (const sel of boardDropdownSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        boardOpened = true;
        break;
      }
    }

    if (boardOpened) {
      await page.waitForTimeout(1000);
      // Try to select board by name in dropdown list
      const boardRowSelector = `div[title*="${job.board.name}" i], div[data-test-id*="board-row"]:has-text("${job.board.name}"), div[role="button"]:has-text("${job.board.name}")`;
      const boardItem = await page.$(boardRowSelector);
      if (boardItem) {
        await boardItem.click();
      } else {
        // If specific board row not found, press Enter or click first available board
        const anyBoard = await page.$('div[data-test-id*="board-row"], div[role="listbox"] div[role="option"]');
        if (anyBoard) await anyBoard.click();
      }
      await page.waitForTimeout(1000);
    }

    // 7. Click Publish / Save
    const publishSelectors = [
      '[data-test-id="board-dropdown-save-button"]',
      'button[data-test-id="publish-button"]',
      'button:has-text("Publish")',
      'button:has-text("Save")',
    ];
    let clickedPublish = false;
    for (const sel of publishSelectors) {
      const el = await page.$(sel);
      if (el && (await el.isVisible())) {
        await el.click();
        clickedPublish = true;
        break;
      }
    }

    if (!clickedPublish) {
      throw new Error("Could not locate the Publish button in Pinterest creation tool.");
    }

    // 8. Wait for creation confirmation or redirect
    // Wait up to 35 seconds for success toast, link, or API capture
    const startTime = Date.now();
    while (Date.now() - startTime < 35000) {
      if (capturedPinId) break;

      // Check specifically for newly appeared success toast
      const toastPinLink = await page.$(
        '[data-test-id="toast"] a[href*="/pin/"], [data-test-id="toast-layer"] a[href*="/pin/"], a[aria-label*="Navigate to created Pin" i]'
      );
      if (toastPinLink) {
        const href = await toastPinLink.getAttribute("href");
        if (href) {
          const match = href.match(/\/pin\/([0-9]+)/);
          if (match) {
            capturedPinId = match[1];
            capturedPinUrl = href.startsWith("http") ? href : `https://www.pinterest.com${href}`;
            break;
          }
        }
      }

      // Check if page navigated to the published pin URL
      const current = page.url();
      if (!current.includes("/pin-creation-tool")) {
        const pinMatch = current.match(/\/pin\/([0-9]+)/);
        if (pinMatch) {
          capturedPinId = pinMatch[1];
          capturedPinUrl = current;
          break;
        }
      }

      await page.waitForTimeout(1000);
    }

    if (!capturedPinId) {
      throw new Error(
        `Pinterest pin publication could not be confirmed for job ${jobId}. Pinterest did not return a publication confirmation within 35 seconds.`
      );
    }

    return {
      pinId: capturedPinId,
      pinUrl: capturedPinUrl ?? `https://www.pinterest.com/pin/${capturedPinId}/`,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

