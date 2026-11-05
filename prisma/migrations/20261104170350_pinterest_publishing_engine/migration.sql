-- CreateTable
CREATE TABLE "PinterestAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pinterestUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "profileImage" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'Connected',
    "lastAuthenticatedAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PinterestBoard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pinterestBoardId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "privacy" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PinterestBoard_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PinterestAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PinterestPublishingJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentPackageId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'AwaitingApproval',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "pinterestPinId" TEXT,
    "pinterestPinUrl" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" DATETIME,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PinterestPublishingJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PinterestAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PinterestPublishingJob_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "PinterestBoard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PinterestPublishingJob_contentPackageId_fkey" FOREIGN KEY ("contentPackageId") REFERENCES "ContentPackage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PinterestOAuthState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PinterestEngineSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engineEnabled" BOOLEAN NOT NULL DEFAULT false,
    "engineStatus" TEXT NOT NULL DEFAULT 'Stopped',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "workerConcurrency" INTEGER NOT NULL DEFAULT 3,
    "retryLimit" INTEGER NOT NULL DEFAULT 3,
    "retryBackoffMs" INTEGER NOT NULL DEFAULT 60000,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PinterestAccount_pinterestUserId_key" ON "PinterestAccount"("pinterestUserId");

-- CreateIndex
CREATE INDEX "PinterestAccount_status_idx" ON "PinterestAccount"("status");

-- CreateIndex
CREATE INDEX "PinterestBoard_accountId_status_idx" ON "PinterestBoard"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PinterestBoard_accountId_pinterestBoardId_key" ON "PinterestBoard"("accountId", "pinterestBoardId");

-- CreateIndex
CREATE INDEX "PinterestPublishingJob_status_availableAt_idx" ON "PinterestPublishingJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "PinterestPublishingJob_approvalStatus_status_idx" ON "PinterestPublishingJob"("approvalStatus", "status");

-- CreateIndex
CREATE INDEX "PinterestPublishingJob_accountId_status_idx" ON "PinterestPublishingJob"("accountId", "status");

-- CreateIndex
CREATE INDEX "PinterestPublishingJob_contentPackageId_idx" ON "PinterestPublishingJob"("contentPackageId");

-- CreateIndex
CREATE INDEX "PinterestPublishingJob_leaseExpiresAt_idx" ON "PinterestPublishingJob"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PinterestOAuthState_state_key" ON "PinterestOAuthState"("state");

-- CreateIndex
CREATE INDEX "PinterestOAuthState_expiresAt_idx" ON "PinterestOAuthState"("expiresAt");
