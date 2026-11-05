/**
 * Pinterest account CRUD and sync service.
 */
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/server/ai/encryption";
import { getUserProfile, getBoards, PinterestAuthError } from "./api-client";
import {
  isBrowserSessionAccount,
  syncBrowserSessionAccount,
  syncBrowserSessionBoards,
} from "./browser-session";
import type { PinterestTokens } from "./oauth";

const MAX_ACCOUNTS = 50;

export class AccountLimitError extends Error {
  constructor() {
    super(`Maximum of ${MAX_ACCOUNTS} Pinterest accounts allowed.`);
    this.name = "AccountLimitError";
  }
}

export class AccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Pinterest account ${id} was not found.`);
    this.name = "AccountNotFoundError";
  }
}

/**
 * Connect (or reconnect) a Pinterest account using fresh OAuth tokens.
 * Also syncs the account profile and boards immediately.
 */
export async function connectAccount(tokens: PinterestTokens): Promise<string> {
  const encryptedAccess = encryptSecret(tokens.accessToken);
  const encryptedRefresh = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken)
    : null;

  // Fetch profile using the new token
  const profile = await getUserProfile(tokens.accessToken, "new");

  const existing = await prisma.pinterestAccount.findUnique({
    where: { pinterestUserId: profile.id },
  });

  if (!existing) {
    const count = await prisma.pinterestAccount.count();
    if (count >= MAX_ACCOUNTS) throw new AccountLimitError();
  }

  const account = await prisma.pinterestAccount.upsert({
    where: { pinterestUserId: profile.id },
    update: {
      username: profile.username,
      displayName: profile.display_name ?? profile.username,
      profileImage: profile.profile_image ?? null,
      accessTokenEncrypted: encryptedAccess,
      refreshTokenEncrypted: encryptedRefresh,
      tokenExpiresAt: tokens.expiresAt ?? null,
      status: "Connected",
      lastAuthenticatedAt: new Date(),
    },
    create: {
      pinterestUserId: profile.id,
      username: profile.username,
      displayName: profile.display_name ?? profile.username,
      profileImage: profile.profile_image ?? null,
      accessTokenEncrypted: encryptedAccess,
      refreshTokenEncrypted: encryptedRefresh,
      tokenExpiresAt: tokens.expiresAt ?? null,
      status: "Connected",
      lastAuthenticatedAt: new Date(),
    },
  });

  // Sync boards immediately
  await syncBoards(account.id).catch((err) =>
    console.warn("Board sync failed during connect:", err),
  );

  return account.id;
}

/**
 * Returns all accounts (without decrypted tokens).
 */
export async function listAccounts() {
  return prisma.pinterestAccount.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      pinterestUserId: true,
      username: true,
      displayName: true,
      profileImage: true,
      status: true,
      lastAuthenticatedAt: true,
      lastSyncedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          boards: true,
          publishingJobs: true,
        },
      },
    },
  });
}

export async function getAccount(accountId: string) {
  const account = await prisma.pinterestAccount.findUnique({
    where: { id: accountId },
    include: {
      boards: { orderBy: { isDefault: "desc" } },
    },
  });
  if (!account) throw new AccountNotFoundError(accountId);
  return account;
}

/** Returns the decrypted access token; refreshes if expired. */
export async function getAccessToken(accountId: string): Promise<string> {
  const account = await prisma.pinterestAccount.findUnique({
    where: { id: accountId },
    select: {
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      tokenExpiresAt: true,
      status: true,
    },
  });
  if (!account) throw new AccountNotFoundError(accountId);

  // Check if token is expiring within 5 minutes
  const needsRefresh =
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;

  if (needsRefresh && account.refreshTokenEncrypted) {
    const { refreshAccessToken } = await import("./oauth");
    try {
      const decryptedRefresh = decryptSecret(account.refreshTokenEncrypted);
      const tokens = await refreshAccessToken(decryptedRefresh);

      await prisma.pinterestAccount.update({
        where: { id: accountId },
        data: {
          accessTokenEncrypted: encryptSecret(tokens.accessToken),
          refreshTokenEncrypted: tokens.refreshToken
            ? encryptSecret(tokens.refreshToken)
            : account.refreshTokenEncrypted,
          tokenExpiresAt: tokens.expiresAt ?? null,
          status: "Connected",
          lastAuthenticatedAt: new Date(),
        },
      });

      return tokens.accessToken;
    } catch (err) {
      await prisma.pinterestAccount.update({
        where: { id: accountId },
        data: { status: "AuthenticationExpired" },
      });
      throw new PinterestAuthError(
        err instanceof Error ? err.message : "Token refresh failed.",
      );
    }
  }

  return decryptSecret(account.accessTokenEncrypted);
}

/**
 * Syncs account profile from Pinterest API.
 * For browser-session accounts, re-extracts data headlessly instead.
 */
export async function syncAccountProfile(accountId: string): Promise<void> {
  const isBrowser = await isBrowserSessionAccount(accountId);
  if (isBrowser) {
    await syncBrowserSessionAccount(accountId);
    return;
  }

  const accessToken = await getAccessToken(accountId);
  const profile = await getUserProfile(accessToken, accountId);

  await prisma.pinterestAccount.update({
    where: { id: accountId },
    data: {
      username: profile.username,
      displayName: profile.display_name ?? profile.username,
      profileImage: profile.profile_image ?? null,
      status: "Connected",
      lastSyncedAt: new Date(),
    },
  });

  await syncBoards(accountId);
}

/**
 * Syncs the board list for one account.
 * For browser-session accounts, re-extracts boards headlessly.
 */
export async function syncBoards(accountId: string): Promise<void> {
  const isBrowser = await isBrowserSessionAccount(accountId);
  if (isBrowser) {
    await syncBrowserSessionBoards(accountId);
    return;
  }

  const accessToken = await getAccessToken(accountId);
  const remoteBoards = await getBoards(accessToken, accountId);

  // Upsert each board
  for (const board of remoteBoards) {
    await prisma.pinterestBoard.upsert({
      where: { accountId_pinterestBoardId: { accountId, pinterestBoardId: board.id } },
      update: {
        name: board.name,
        description: board.description ?? null,
        privacy: board.privacy ?? null,
        status: "Active",
        lastSyncedAt: new Date(),
      },
      create: {
        accountId,
        pinterestBoardId: board.id,
        name: board.name,
        description: board.description ?? null,
        privacy: board.privacy ?? null,
        status: "Active",
        lastSyncedAt: new Date(),
      },
    });
  }

  // Mark boards not returned as Unavailable
  const remoteIds = new Set(remoteBoards.map((b) => b.id));
  const localBoards = await prisma.pinterestBoard.findMany({
    where: { accountId },
    select: { id: true, pinterestBoardId: true },
  });
  const toDisable = localBoards.filter((b) => !remoteIds.has(b.pinterestBoardId));
  if (toDisable.length > 0) {
    await prisma.pinterestBoard.updateMany({
      where: { id: { in: toDisable.map((b) => b.id) } },
      data: { status: "Unavailable" },
    });
  }

  await prisma.pinterestAccount.update({
    where: { id: accountId },
    data: { lastSyncedAt: new Date() },
  });
}

/**
 * Disconnects an account: clears tokens, marks Disconnected.
 * Does NOT delete the account record or its publishing history.
 */
export async function disconnectAccount(accountId: string): Promise<void> {
  const account = await prisma.pinterestAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new AccountNotFoundError(accountId);

  await prisma.pinterestAccount.update({
    where: { id: accountId },
    data: {
      accessTokenEncrypted: "",
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
      status: "Disconnected",
    },
  });

  // Cancel pending jobs for this account
  await prisma.pinterestPublishingJob.updateMany({
    where: {
      accountId,
      status: { in: ["Draft", "AwaitingApproval", "Scheduled", "Pending"] },
    },
    data: { status: "Cancelled" },
  });
}

/**
 * Permanently deletes an account record and all its data.
 */
export async function deleteAccount(accountId: string): Promise<void> {
  const account = await prisma.pinterestAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new AccountNotFoundError(accountId);
  await prisma.pinterestAccount.delete({ where: { id: accountId } });
}

/**
 * Sets the default board for an account.
 */
export async function setDefaultBoard(accountId: string, boardId: string): Promise<void> {
  await prisma.$transaction([
    prisma.pinterestBoard.updateMany({
      where: { accountId },
      data: { isDefault: false },
    }),
    prisma.pinterestBoard.update({
      where: { id: boardId },
      data: { isDefault: true },
    }),
  ]);
}

