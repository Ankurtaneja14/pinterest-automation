/**
 * Pinterest Browser Session Manager.
 *
 * Allows users to log in directly to Pinterest in a visible browser window.
 * Once authenticated, extracts session cookies (_auth, _pinterest_sess) and
 * exports Playwright storageState so it can be re-opened in a headless window
 * for automated pin uploading.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/server/ai/encryption";
import { PinterestAuthError } from "./api-client";

const MAX_ACCOUNTS = 50;
const SESSION_STORAGE_DIR = path.resolve(process.cwd(), "storage", "pinterest-sessions");

export interface LoginSessionState {
  sessionId: string;
  status: "waiting_for_login" | "extracting_data" | "complete" | "failed" | "cancelled";
  message?: string;
  account?: {
    id: string;
    username: string;
    displayName: string;
    boardsCount: number;
  };
  startedAt: number;
}

interface ActiveSessionRecord {
  state: LoginSessionState;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  monitorInterval?: NodeJS.Timeout;
}

const activeSessions = new Map<string, ActiveSessionRecord>();

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

export function getSessionStoragePath(accountId: string): string {
  return path.join(SESSION_STORAGE_DIR, `${accountId}.json`);
}

/**
 * Checks if an account is authenticated via a browser session (cookies).
 */
export async function isBrowserSessionAccount(accountId: string): Promise<boolean> {
  try {
    const account = await prisma.pinterestAccount.findUnique({
      where: { id: accountId },
      select: { accessTokenEncrypted: true },
    });
    if (!account?.accessTokenEncrypted) return false;
    const decrypted = decryptSecret(account.accessTokenEncrypted);
    return decrypted.includes("browser_session");
  } catch {
    return false;
  }
}

/**
 * Ensures the Playwright storageState file exists on disk for the account.
 * If missing, reconstructs it from the encrypted cookies in the database.
 */
export async function ensureSessionStorageFile(accountId: string): Promise<string> {
  await fs.mkdir(SESSION_STORAGE_DIR, { recursive: true });
  const filePath = getSessionStoragePath(accountId);

  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    // Reconstruct from DB
    const account = await prisma.pinterestAccount.findUnique({
      where: { id: accountId },
      select: { accessTokenEncrypted: true },
    });
    if (!account?.accessTokenEncrypted) {
      throw new Error(`No credentials found for Pinterest account ${accountId}.`);
    }

    const decrypted = decryptSecret(account.accessTokenEncrypted);
    let sessionData: any;
    try {
      sessionData = JSON.parse(decrypted);
    } catch {
      throw new Error("Invalid session data stored in account.");
    }

    const storagePayload = {
      cookies: sessionData.cookies ?? [],
      origins: [],
    };
    await fs.writeFile(filePath, JSON.stringify(storagePayload, null, 2), "utf8");
    return filePath;
  }
}

/**
 * Launches a visible Chrome window to Pinterest login page and begins
 * monitoring for successful authentication.
 */
export async function startPinterestLoginSession(): Promise<{ sessionId: string }> {
  // Clean up any stale sessions (> 10 minutes)
  const now = Date.now();
  for (const [id, rec] of activeSessions.entries()) {
    if (now - rec.state.startedAt > 10 * 60 * 1000) {
      await rec.browser.close().catch(() => {});
      activeSessions.delete(id);
    }
  }

  const accountCount = await prisma.pinterestAccount.count();
  if (accountCount >= MAX_ACCOUNTS) {
    throw new Error(`Maximum of ${MAX_ACCOUNTS} accounts allowed.`);
  }

  const sessionId = `psess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const executablePath = await findSystemChrome();

  const launchOptions: any = {
    headless: false,
    args: [
      "--start-maximized",
      "--disable-infobars",
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  };
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else {
    launchOptions.channel = "chrome";
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: null,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const state: LoginSessionState = {
    sessionId,
    status: "waiting_for_login",
    message: "Chrome window opened. Please log in to your Pinterest account in the opened window.",
    startedAt: now,
  };

  const record: ActiveSessionRecord = {
    state,
    browser,
    context,
    page,
  };

  activeSessions.set(sessionId, record);

  await page.goto("https://www.pinterest.com/login/", { waitUntil: "domcontentloaded" }).catch(() => {});

  // Start polling loop to detect login
  record.monitorInterval = setInterval(async () => {
    try {
      if (page.isClosed()) {
        state.status = "cancelled";
        state.message = "Login window was closed.";
        clearInterval(record.monitorInterval);
        activeSessions.delete(sessionId);
        return;
      }

      const cookies = await context.cookies("https://www.pinterest.com");
      const isAuth = cookies.some(
        (c) => (c.name === "_auth" && c.value === "1") || (c.name === "_pinterest_sess" && c.value.length > 5),
      );
      const url = page.url();
      const leftLoginPage = !url.includes("/login") && !url.includes("/signup");

      if (isAuth && leftLoginPage) {
        clearInterval(record.monitorInterval);
        state.status = "extracting_data";
        state.message = "Login detected! Extracting account profile and boards...";

        // Process login capture
        await handleSuccessfulLogin(record);
      }
    } catch (pollErr) {
      console.warn("Pinterest login poll warning:", pollErr);
    }
  }, 2000);

  return { sessionId };
}

export interface ExtractedPinterestData {
  user: {
    id: string;
    username: string;
    displayName: string;
    profileImage: string | null;
  } | null;
  boards: Array<{
    id: string;
    name: string;
    description: string | null;
    privacy: string;
  }>;
}

/**
 * Robustly extracts the logged in user's profile and Pinterest boards
 * by listening to Pinterest's native internal resource responses on /pin-creation-tool/.
 */
export async function extractPinterestProfileAndBoards(page: Page): Promise<ExtractedPinterestData> {
  const capturedBoards: Array<{ id: string; name: string; description: string | null; privacy: string }> = [];
  let userProfile: ExtractedPinterestData["user"] = null;

  let resolveBoards: (() => void) | null = null;
  const boardsPromise = new Promise<void>((resolve) => {
    resolveBoards = resolve;
  });

  const responseHandler = async (res: any) => {
    try {
      const url = res.url();
      if (!res.ok()) return;

      // 1. Capture Boards from BoardPickerBoardsResource or BoardsResource
      if (url.includes("BoardPickerBoardsResource") || url.includes("BoardsResource")) {
        try {
          const json = await res.json();
          const data = json?.resource_response?.data;
          if (data?.all_boards && Array.isArray(data.all_boards) && data.all_boards.length > 0) {
            for (const b of data.all_boards) {
              if (b.name) {
                capturedBoards.push({
                  id: String(b.id || b.node_id || `board_${b.name}`),
                  name: String(b.name).trim(),
                  description: b.description ? String(b.description) : null,
                  privacy: b.privacy ? String(b.privacy) : "public",
                });
                if (!userProfile && b.owner?.username) {
                  userProfile = {
                    id: String(b.owner.id || b.owner.node_id || b.owner.username),
                    username: String(b.owner.username),
                    displayName: String(b.owner.full_name || b.owner.username),
                    profileImage: b.owner.image_xlarge_url || b.owner.image_medium_url || null,
                  };
                }
              }
            }
            if (resolveBoards) resolveBoards();
          }
          if (Array.isArray(data)) {
            for (const b of data) {
              if (b.name) {
                capturedBoards.push({
                  id: String(b.id || b.node_id || `board_${b.name}`),
                  name: String(b.name).trim(),
                  description: b.description ? String(b.description) : null,
                  privacy: b.privacy ? String(b.privacy) : "public",
                });
              }
            }
          }
        } catch {}
      }

      // 2. Capture Profile
      if (
        url.includes("UserSettingsResource") ||
        url.includes("UserResource") ||
        url.includes("ProfileUserResource")
      ) {
        try {
          const json = await res.json();
          const d = json?.resource_response?.data;
          if (d?.username) {
            userProfile = {
              id: String(d.id || d.user_id || d.username),
              username: String(d.username),
              displayName: String(d.full_name || d.username),
              profileImage: d.image_xlarge_url || d.image_medium_url || null,
            };
          }
        } catch {}
      }
    } catch {}
  };

  page.on("response", responseHandler);

  try {
    // Navigate to pin-creation-tool which natively triggers Pinterest's internal BoardPickerBoardsResource
    await page.goto("https://www.pinterest.com/pin-creation-tool/", {
      waitUntil: "domcontentloaded",
      timeout: 35000,
    }).catch(() => {});

    // Wait until boards arrive or max 7s timeout
    await Promise.race([
      boardsPromise,
      page.waitForTimeout(7000),
    ]);

    // Fallback: check __PRELOADED_STATE__ if profile still null
    if (!userProfile) {
      const preloaded = await page.evaluate(() => {
        try {
          const s = (window as any).__PRELOADED_STATE__;
          const u = s?.user || s?.viewer;
          if (u?.username) {
            return {
              id: String(u.id || u.username),
              username: String(u.username),
              displayName: String(u.full_name || u.username),
              profileImage: u.image_xlarge_url || u.image_medium_url || null,
            };
          }
        } catch {}
        return null;
      });
      if (preloaded) userProfile = preloaded;
    }
  } finally {
    page.off("response", responseHandler);
  }

  // Deduplicate boards by name
  const uniqueBoards: Array<{ id: string; name: string; description: string | null; privacy: string }> = [];
  const seenNames = new Set<string>();
  for (const b of capturedBoards) {
    if (b.name && !seenNames.has(b.name.toLowerCase())) {
      seenNames.add(b.name.toLowerCase());
      uniqueBoards.push(b);
    }
  }

  return {
    user: userProfile,
    boards: uniqueBoards,
  };
}

/**
 * Extracts profile & boards from the logged in page, saves storageState,
 * updates DB, and closes browser.
 */
async function handleSuccessfulLogin(record: ActiveSessionRecord) {
  const { page, context, browser, state } = record;
  const sessionId = state.sessionId;

  try {
    const extracted = await extractPinterestProfileAndBoards(page);

    const cookies = await context.cookies();
    const sessCookie = cookies.find((c) => c.name === "_pinterest_sess");
    const sessionPayload = {
      authType: "browser_session",
      sessionId: sessCookie?.value || "",
      cookies,
      savedAt: new Date().toISOString(),
    };
    const encryptedToken = encryptSecret(JSON.stringify(sessionPayload));

    let username = extracted.user?.username;
    let userId = extracted.user?.id;
    let displayName = extracted.user?.displayName;
    const profileImage = extracted.user?.profileImage;

    if (!username) {
      username = `user_${Date.now().toString().slice(-6)}`;
    }
    userId = userId || `uid_${username}`;
    displayName = displayName || username;

    // 4. Save account in Prisma
    const account = await prisma.pinterestAccount.upsert({
      where: { pinterestUserId: userId },
      update: {
        username,
        displayName,
        profileImage: profileImage || null,
        accessTokenEncrypted: encryptedToken,
        status: "Connected",
        lastAuthenticatedAt: new Date(),
        lastSyncedAt: new Date(),
      },
      create: {
        pinterestUserId: userId,
        username,
        displayName,
        profileImage: profileImage || null,
        accessTokenEncrypted: encryptedToken,
        status: "Connected",
        lastAuthenticatedAt: new Date(),
        lastSyncedAt: new Date(),
      },
    });

    // 5. Save Playwright storageState file
    await fs.mkdir(SESSION_STORAGE_DIR, { recursive: true });
    const sessionFilePath = getSessionStoragePath(account.id);
    await context.storageState({ path: sessionFilePath });

    // 6. Save boards in Prisma
    let boardsSaved = 0;
    for (let i = 0; i < extracted.boards.length; i++) {
      const b = extracted.boards[i];
      if (b.name) {
        await prisma.pinterestBoard.upsert({
          where: {
            accountId_pinterestBoardId: {
              accountId: account.id,
              pinterestBoardId: b.id,
            },
          },
          update: {
            name: b.name,
            description: b.description || null,
            privacy: b.privacy || null,
            status: "Active",
            lastSyncedAt: new Date(),
          },
          create: {
            accountId: account.id,
            pinterestBoardId: b.id,
            name: b.name,
            description: b.description || null,
            privacy: b.privacy || null,
            isDefault: i === 0,
            status: "Active",
            lastSyncedAt: new Date(),
          },
        });
        boardsSaved++;
      }
    }

    state.status = "complete";
    state.message = `Account @${username} connected successfully with ${boardsSaved} boards!`;
    state.account = {
      id: account.id,
      username,
      displayName,
      boardsCount: boardsSaved,
    };
  } catch (err) {
    state.status = "failed";
    state.message = err instanceof Error ? err.message : "Failed to capture Pinterest session.";
  } finally {
    // Close browser after brief pause so user sees completion
    setTimeout(async () => {
      await browser.close().catch(() => {});
      activeSessions.delete(sessionId);
    }, 1500);
  }
}

export function getPinterestLoginSessionStatus(sessionId: string): LoginSessionState {
  const rec = activeSessions.get(sessionId);
  if (!rec) {
    return {
      sessionId,
      status: "failed",
      message: "Session expired or not found.",
      startedAt: Date.now(),
    };
  }
  return rec.state;
}

export async function cancelPinterestLoginSession(sessionId: string): Promise<void> {
  const rec = activeSessions.get(sessionId);
  if (rec) {
    if (rec.monitorInterval) clearInterval(rec.monitorInterval);
    await rec.browser.close().catch(() => {});
    activeSessions.delete(sessionId);
  }
}

/**
 * Headlessly synchronizes account profile and boards for a browser session account.
 */
export async function syncBrowserSessionAccount(accountId: string): Promise<void> {
  const account = await prisma.pinterestAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) {
    throw new Error(`Account ${accountId} not found.`);
  }

  const sessionFilePath = await ensureSessionStorageFile(accountId);
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
      storageState: sessionFilePath,
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // Extract profile and boards using the response listener
    const extracted = await extractPinterestProfileAndBoards(page);

    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("/signup")) {
      await prisma.pinterestAccount.update({
        where: { id: accountId },
        data: { status: "AuthenticationExpired" },
      });
      throw new PinterestAuthError(
        `Pinterest session expired for @${account.username}. Please re-login via Pinterest Accounts.`,
      );
    }

    // 3. Update cookies in DB and storageState
    const cookies = await context.cookies();
    const sessCookie = cookies.find((c) => c.name === "_pinterest_sess");
    const sessionPayload = {
      authType: "browser_session",
      sessionId: sessCookie?.value || "",
      cookies,
      savedAt: new Date().toISOString(),
    };
    const encryptedToken = encryptSecret(JSON.stringify(sessionPayload));

    await prisma.pinterestAccount.update({
      where: { id: accountId },
      data: {
        username: extracted.user?.username || account.username,
        displayName: extracted.user?.displayName || account.displayName,
        profileImage: extracted.user?.profileImage || account.profileImage,
        accessTokenEncrypted: encryptedToken,
        status: "Connected",
        lastSyncedAt: new Date(),
      },
    });

    await context.storageState({ path: sessionFilePath });

    // 4. Update boards
    const remoteBoardIds = new Set<string>();
    for (let i = 0; i < extracted.boards.length; i++) {
      const b = extracted.boards[i];
      if (b.name) {
        remoteBoardIds.add(b.id);
        await prisma.pinterestBoard.upsert({
          where: {
            accountId_pinterestBoardId: {
              accountId,
              pinterestBoardId: b.id,
            },
          },
          update: {
            name: b.name,
            description: b.description || null,
            privacy: b.privacy || null,
            status: "Active",
            lastSyncedAt: new Date(),
          },
          create: {
            accountId,
            pinterestBoardId: b.id,
            name: b.name,
            description: b.description || null,
            privacy: b.privacy || null,
            isDefault: i === 0,
            status: "Active",
            lastSyncedAt: new Date(),
          },
        });
      }
    }

    // Mark missing boards as unavailable if any remote boards returned
    if (remoteBoardIds.size > 0) {
      const localBoards = await prisma.pinterestBoard.findMany({
        where: { accountId },
        select: { id: true, pinterestBoardId: true },
      });
      const toDisable = localBoards.filter((b) => !remoteBoardIds.has(b.pinterestBoardId));
      if (toDisable.length > 0) {
        await prisma.pinterestBoard.updateMany({
          where: { id: { in: toDisable.map((b) => b.id) } },
          data: { status: "Unavailable" },
        });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function syncBrowserSessionBoards(accountId: string): Promise<void> {
  return syncBrowserSessionAccount(accountId);
}
