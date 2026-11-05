-- CreateTable
CREATE TABLE "NicheSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleKey" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "executionDate" DATETIME NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "researchIdeasCount" INTEGER NOT NULL,
    "pinsToGenerate" INTEGER NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "workbookRelativePath" TEXT,
    "sourceRow" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExecutionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "stage" TEXT NOT NULL DEFAULT 'Queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "checkpointJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExecutionJob_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "NicheSchedule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reportJson" TEXT,
    "reportPath" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchSession_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ExecutionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "researchSessionId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "publishedAt" TEXT,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excerpt" TEXT NOT NULL,
    "relevance" TEXT,
    CONSTRAINT "ResearchSource_researchSessionId_fkey" FOREIGN KEY ("researchSessionId") REFERENCES "ResearchSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "researchSessionId" TEXT,
    "ideaKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "coreConcept" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "audienceSegment" TEXT NOT NULL,
    "audienceNeed" TEXT NOT NULL,
    "searchIntent" TEXT NOT NULL,
    "keywordsJson" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "sourceReferencesJson" TEXT NOT NULL,
    "visualDirection" TEXT NOT NULL,
    "contentFormat" TEXT NOT NULL,
    "trendClassification" TEXT NOT NULL,
    "destinationRelevance" TEXT NOT NULL,
    "validationStatus" TEXT NOT NULL DEFAULT 'Valid',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentIdea_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ExecutionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentIdea_researchSessionId_fkey" FOREIGN KEY ("researchSessionId") REFERENCES "ResearchSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdeaScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ideaId" TEXT NOT NULL,
    "trendRelevance" INTEGER NOT NULL,
    "audienceResonance" INTEGER NOT NULL,
    "searchPotential" INTEGER NOT NULL,
    "clickPotential" INTEGER NOT NULL,
    "visualAppeal" INTEGER NOT NULL,
    "originality" INTEGER NOT NULL,
    "evergreenValue" INTEGER NOT NULL,
    "finalScore" REAL NOT NULL,
    "reasoningJson" TEXT NOT NULL,
    "strengthsJson" TEXT NOT NULL,
    "weaknessesJson" TEXT NOT NULL,
    "improvementSuggestionsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdeaScore_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ContentIdea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SelectedIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SelectedIdea_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ExecutionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SelectedIdea_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ContentIdea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "pinterestTitle" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hashtagsJson" TEXT NOT NULL,
    "keywordsJson" TEXT NOT NULL,
    "imagePrompt" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "generationStatus" TEXT NOT NULL DEFAULT 'Pending',
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentPackage_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ContentIdea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneratedAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "contentPackageId" TEXT,
    "relativePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "format" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "validationJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneratedAsset_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ExecutionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GeneratedAsset_contentPackageId_fkey" FOREIGN KEY ("contentPackageId") REFERENCES "ContentPackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stage" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 4096,
    "requestTimeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "retryLimit" INTEGER NOT NULL DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadataJson" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutionLog_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ExecutionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StorageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "sha256" TEXT,
    "deletionState" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "StorageRecord_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ExecutionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NicheSchedule_scheduleKey_key" ON "NicheSchedule"("scheduleKey");

-- CreateIndex
CREATE INDEX "NicheSchedule_executionDate_status_idx" ON "NicheSchedule"("executionDate", "status");

-- CreateIndex
CREATE INDEX "NicheSchedule_niche_idx" ON "NicheSchedule"("niche");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionJob_idempotencyKey_key" ON "ExecutionJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ExecutionJob_status_availableAt_idx" ON "ExecutionJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "ExecutionJob_leaseExpiresAt_idx" ON "ExecutionJob"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ExecutionJob_scheduleId_idx" ON "ExecutionJob"("scheduleId");

-- CreateIndex
CREATE INDEX "ResearchSession_executionId_status_idx" ON "ResearchSession"("executionId", "status");

-- CreateIndex
CREATE INDEX "ResearchSource_researchSessionId_idx" ON "ResearchSource"("researchSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_researchSessionId_canonicalUrl_key" ON "ResearchSource"("researchSessionId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "ContentIdea_executionId_createdAt_idx" ON "ContentIdea"("executionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentIdea_executionId_ideaKey_key" ON "ContentIdea"("executionId", "ideaKey");

-- CreateIndex
CREATE UNIQUE INDEX "IdeaScore_ideaId_key" ON "IdeaScore"("ideaId");

-- CreateIndex
CREATE UNIQUE INDEX "SelectedIdea_ideaId_key" ON "SelectedIdea"("ideaId");

-- CreateIndex
CREATE INDEX "SelectedIdea_executionId_selected_idx" ON "SelectedIdea"("executionId", "selected");

-- CreateIndex
CREATE UNIQUE INDEX "SelectedIdea_executionId_rank_key" ON "SelectedIdea"("executionId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPackage_contentId_key" ON "ContentPackage"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPackage_ideaId_key" ON "ContentPackage"("ideaId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedAsset_relativePath_key" ON "GeneratedAsset"("relativePath");

-- CreateIndex
CREATE INDEX "GeneratedAsset_executionId_status_idx" ON "GeneratedAsset"("executionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AIConfiguration_stage_key" ON "AIConfiguration"("stage");

-- CreateIndex
CREATE INDEX "ExecutionLog_executionId_createdAt_idx" ON "ExecutionLog"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionLog_stage_level_idx" ON "ExecutionLog"("stage", "level");

-- CreateIndex
CREATE UNIQUE INDEX "StorageRecord_relativePath_key" ON "StorageRecord"("relativePath");

-- CreateIndex
CREATE INDEX "StorageRecord_executionId_category_idx" ON "StorageRecord"("executionId", "category");

-- CreateIndex
CREATE INDEX "StorageRecord_deletionState_idx" ON "StorageRecord"("deletionState");
