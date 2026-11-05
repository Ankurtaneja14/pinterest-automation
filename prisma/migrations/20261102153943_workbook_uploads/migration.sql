-- CreateTable
CREATE TABLE "WorkbookUpload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "relativePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "importedScheduleCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookUpload_relativePath_key" ON "WorkbookUpload"("relativePath");

-- CreateIndex
CREATE INDEX "WorkbookUpload_createdAt_idx" ON "WorkbookUpload"("createdAt");
