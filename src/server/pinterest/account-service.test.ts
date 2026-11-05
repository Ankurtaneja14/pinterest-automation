import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listAccounts,
  getAccount,
  disconnectAccount,
  deleteAccount,
  setDefaultBoard,
  AccountNotFoundError,
  AccountLimitError,
} from "./account-service";

describe("Pinterest Account Service", () => {
  let testAccountId: string;

  beforeEach(async () => {
    // Create a mock account directly
    const account = await prisma.pinterestAccount.upsert({
      where: { pinterestUserId: "test-user-acc-service" },
      update: {
        status: "Connected",
      },
      create: {
        pinterestUserId: "test-user-acc-service",
        username: "testaccuser",
        displayName: "Test Acc User",
        accessTokenEncrypted: "enc-dummy-token",
        status: "Connected",
      },
    });
    testAccountId = account.id;

    // Create 2 test boards
    await prisma.pinterestBoard.upsert({
      where: {
        accountId_pinterestBoardId: {
          accountId: testAccountId,
          pinterestBoardId: "b-1",
        },
      },
      update: {},
      create: {
        accountId: testAccountId,
        pinterestBoardId: "b-1",
        name: "Board One",
        isDefault: true,
      },
    });

    await prisma.pinterestBoard.upsert({
      where: {
        accountId_pinterestBoardId: {
          accountId: testAccountId,
          pinterestBoardId: "b-2",
        },
      },
      update: {},
      create: {
        accountId: testAccountId,
        pinterestBoardId: "b-2",
        name: "Board Two",
        isDefault: false,
      },
    });
  });

  afterEach(async () => {
    await prisma.pinterestBoard.deleteMany({
      where: { accountId: testAccountId },
    });
    await prisma.pinterestAccount.deleteMany({
      where: { id: testAccountId },
    });
  });

  it("lists all connected accounts without leaking encrypted secrets", async () => {
    const accounts = await listAccounts();
    expect(accounts.length).toBeGreaterThan(0);
    const found = accounts.find((a) => a.id === testAccountId);
    expect(found).toBeDefined();
    expect(found?.username).toBe("testaccuser");
    // Secrets should not be present in public listing
    expect((found as any).accessTokenEncrypted).toBeUndefined();
    expect((found as any).refreshTokenEncrypted).toBeUndefined();
  });

  it("retrieves account with boards", async () => {
    const account = await getAccount(testAccountId);
    expect(account.id).toBe(testAccountId);
    expect(account.boards).toHaveLength(2);
    expect(account.boards.find((b) => b.isDefault)?.name).toBe("Board One");
  });

  it("updates default board selection atomically", async () => {
    const account = await getAccount(testAccountId);
    const boardTwo = account.boards.find((b) => b.name === "Board Two");
    expect(boardTwo).toBeDefined();

    await setDefaultBoard(testAccountId, boardTwo!.id);

    const updated = await getAccount(testAccountId);
    const updatedB1 = updated.boards.find((b) => b.name === "Board One");
    const updatedB2 = updated.boards.find((b) => b.name === "Board Two");

    expect(updatedB1?.isDefault).toBe(false);
    expect(updatedB2?.isDefault).toBe(true);
  });

  it("disconnects account by clearing tokens and setting status", async () => {
    await disconnectAccount(testAccountId);
    const account = await prisma.pinterestAccount.findUnique({
      where: { id: testAccountId },
    });
    expect(account?.status).toBe("Disconnected");
    expect(account?.accessTokenEncrypted).toBe("");
    expect(account?.refreshTokenEncrypted).toBeNull();
  });

  it("throws AccountNotFoundError when accessing nonexistent account", async () => {
    await expect(getAccount("nonexistent-acc-id")).rejects.toThrow(AccountNotFoundError);
  });
});

