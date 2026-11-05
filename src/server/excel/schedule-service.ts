import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { resolveStoragePath } from "../storage/local-storage";
import type { ScheduleImportRow } from "./schedule-import";

async function saveOriginalWorkbook(file: Buffer): Promise<string> {
  const relativePath = `uploads/${randomUUID()}.xlsx`;
  const absolutePath = resolveStoragePath(relativePath);
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;

  await mkdir(path.dirname(absolutePath), { recursive: true });
  try {
    await writeFile(temporaryPath, file, { flag: "wx" });
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Could not remove incomplete workbook upload", cleanupError);
      }
    }
    throw error;
  }

  return relativePath;
}

export class ScheduleNotFoundError extends Error {
  constructor(message = "Schedule not found.") {
    super(message);
    this.name = "ScheduleNotFoundError";
  }
}

/**
 * Deletes a schedule and all its associated executions, ideas, content packages,
 * assets, and jobs cleanly.
 */
export async function deleteSchedule(
  scheduleId: string,
  database: PrismaClient = prisma,
): Promise<{ id: string; niche: string }> {
  return database.$transaction(async (transaction) => {
    const schedule = await transaction.nicheSchedule.findUnique({
      where: { id: scheduleId },
      select: { id: true, niche: true },
    });

    if (!schedule) {
      throw new ScheduleNotFoundError();
    }

    // Find all executions belonging to this schedule
    const executions = await transaction.executionJob.findMany({
      where: { scheduleId },
      select: { id: true },
    });
    const executionIds = executions.map((e) => e.id);

    if (executionIds.length > 0) {
      // Find content packages linked to these executions via ideas
      const ideas = await transaction.contentIdea.findMany({
        where: { executionId: { in: executionIds } },
        select: { id: true },
      });
      const ideaIds = ideas.map((i) => i.id);

      if (ideaIds.length > 0) {
        const contentPackages = await transaction.contentPackage.findMany({
          where: { ideaId: { in: ideaIds } },
          select: { id: true },
        });
        const packageIds = contentPackages.map((p) => p.id);

        if (packageIds.length > 0) {
          // Delete Pinterest publishing jobs linked to these content packages
          await transaction.pinterestPublishingJob.deleteMany({
            where: { contentPackageId: { in: packageIds } },
          });

          // Delete assets linked to these content packages
          await transaction.generatedAsset.deleteMany({
            where: { contentPackageId: { in: packageIds } },
          });

          // Delete content packages
          await transaction.contentPackage.deleteMany({
            where: { id: { in: packageIds } },
          });
        }
      }

      // Delete execution jobs (cascades researchSessions, contentIdeas, selectedIdeas, logs, storageRecords)
      await transaction.executionJob.deleteMany({
        where: { id: { in: executionIds } },
      });
    }

    // Delete the schedule
    await transaction.nicheSchedule.delete({
      where: { id: scheduleId },
    });

    return schedule;
  });
}

export interface ScheduleImportResult {
  imported: number;
  updated: number;
  skipped: number;
  workbookRelativePath: string;
}

export async function importSchedules(
  file: Buffer,
  rows: ScheduleImportRow[],
  database: PrismaClient = prisma,
): Promise<ScheduleImportResult> {
  const workbookRelativePath = await saveOriginalWorkbook(file);

  try {
    const result = await database.$transaction(async (transaction) => {
      let imported = 0;
      let updated = 0;
      let skipped = 0;

      await transaction.workbookUpload.create({
        data: {
          relativePath: workbookRelativePath,
          sha256: createHash("sha256").update(file).digest("hex"),
          sizeBytes: BigInt(file.byteLength),
          importedScheduleCount: rows.length,
        },
      });

      for (const row of rows) {
        const existing = await transaction.nicheSchedule.findUnique({
          where: { scheduleKey: row.scheduleKey },
        });
        const data = {
          niche: row.niche,
          executionDate: new Date(`${row.executionDate}T00:00:00.000Z`),
          targetCountry: row.targetCountry,
          targetAudience: row.targetAudience,
          language: row.language,
          researchIdeasCount: row.researchIdeasCount,
          pinsToGenerate: row.pinsToGenerate,
          destinationUrl: row.destinationUrl,
          workbookRelativePath,
          sourceRow: row.sourceRow,
        };

        if (!existing) {
          await transaction.nicheSchedule.create({
            data: {
              ...data,
              scheduleKey: row.scheduleKey,
              status: row.status,
            },
          });
          imported += 1;
        } else if (existing.status === "Pending") {
          await transaction.nicheSchedule.update({
            where: { id: existing.id },
            data: { ...data, status: row.status },
          });
          updated += 1;
        } else {
          skipped += 1;
        }
      }

      return { imported, updated, skipped };
    });

    return { ...result, workbookRelativePath };
  } catch (error) {
    try {
      await unlink(resolveStoragePath(workbookRelativePath));
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Could not remove workbook after failed schedule import", cleanupError);
      }
    }
    throw error;
  }
}
