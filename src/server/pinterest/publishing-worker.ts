/**
 * Background publishing worker.
 *
 * Uses the same SQLite-backed lease pattern as the existing ExecutionJob worker.
 * This module is intended to be called from the Engine Controller API route
 * on a poll interval — it is NOT a separate process.
 *
 * Concurrency is controlled by the PinterestEngineSettings.workerConcurrency
 * setting (default 3). Each invocation of `processDueJobs()` claims up to
 * `concurrency` jobs atomically via a lease, executes them, then releases.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { getAccessToken } from "./account-service";
import { createPin, PinterestAuthError, PinterestRateLimitError } from "./api-client";
import { resolveStoragePath } from "@/server/storage/local-storage";
import { isBrowserSessionAccount } from "./browser-session";
import { publishPinWithHeadlessBrowser } from "./headless-uploader";

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const BASE_BACKOFF_MS = 60_000; // 1 minute base retry backoff

/** Returns current engine settings, creating defaults if missing. */
export async function getOrCreateEngineSettings() {
  let settings = await prisma.pinterestEngineSettings.findFirst();
  if (!settings) {
    settings = await prisma.pinterestEngineSettings.create({
      data: {},
    });
  }
  return settings;
}

export async function updateEngineSettings(data: {
  engineEnabled?: boolean;
  engineStatus?: string;
  workerConcurrency?: number;
  retryLimit?: number;
  timezone?: string;
}) {
  const settings = await getOrCreateEngineSettings();
  return prisma.pinterestEngineSettings.update({
    where: { id: settings.id },
    data,
  });
}

/**
 * Recover stale leases: jobs whose lease has expired but are still Processing.
 */
export async function recoverStaleLeasedJobs(): Promise<number> {
  const result = await prisma.pinterestPublishingJob.updateMany({
    where: {
      status: "Processing",
      leaseExpiresAt: { lt: new Date() },
    },
    data: {
      status: "RetryPending",
      leaseOwner: null,
      leaseExpiresAt: null,
      availableAt: new Date(Date.now() + 30_000), // retry in 30s
    },
  });
  return result.count;
}

/**
 * Claim eligible jobs up to `concurrency` limit.
 * Eligible = status Scheduled OR RetryPending, approvalStatus Approved,
 *            scheduledAt/availableAt in the past.
 */
async function claimDueJobs(
  workerId: string,
  concurrency: number,
  retryLimit: number,
): Promise<string[]> {
  const now = new Date();
  const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS);

  // Find candidates
  const candidates = await prisma.pinterestPublishingJob.findMany({
    where: {
      approvalStatus: "Approved",
      status: { in: ["Scheduled", "RetryPending"] },
      availableAt: { lte: now },
      retryCount: { lt: retryLimit },
    },
    orderBy: { availableAt: "asc" },
    take: concurrency,
    select: { id: true, retryCount: true },
  });

  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);

  // Atomic claim
  await prisma.pinterestPublishingJob.updateMany({
    where: { id: { in: ids }, status: { in: ["Scheduled", "RetryPending"] } },
    data: {
      status: "Processing",
      leaseOwner: workerId,
      leaseExpiresAt: leaseExpiry,
      startedAt: now,
    },
  });

  return ids;
}

/** Publishes one job via the Pinterest API. */
async function executeJob(jobId: string): Promise<void> {
  const job = await prisma.pinterestPublishingJob.findUnique({
    where: { id: jobId },
    include: {
      contentPackage: {
        include: {
          assets: {
            where: { status: "Complete" },
            take: 1,
          },
        },
      },
      board: { select: { pinterestBoardId: true } },
    },
  });

  if (!job) throw new Error(`Job ${jobId} not found`);

  // Validate content
  const pkg = job.contentPackage;
  const asset = pkg.assets[0];
  if (!asset) {
    throw new Error("No complete image asset available for this content package.");
  }

  // Check whether this account uses headless browser session or OAuth
  const isBrowser = await isBrowserSessionAccount(job.accountId);
  let pinId: string;
  let pinUrl: string;

  if (isBrowser) {
    const result = await publishPinWithHeadlessBrowser(jobId);
    pinId = result.pinId;
    pinUrl = result.pinUrl;
  } else {
    // Build a publicly accessible image URL for official Pinterest API
    const appBase = process.env.APP_BASE_URL ?? "http://127.0.0.1:4000";
    const imageUrl = `${appBase}/api/images/assets/${encodeURIComponent(asset.id)}`;

    // Get decrypted token (auto-refreshes if needed)
    const accessToken = await getAccessToken(job.accountId);

    let hashtags: string[] = [];
    if (pkg.hashtagsJson) {
      try {
        const parsed = JSON.parse(pkg.hashtagsJson);
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
        ? `${pkg.description}\n\n${hashtags.join(" ")}`
        : pkg.description;

    const pin = await createPin(accessToken, job.accountId, {
      boardId: job.board.pinterestBoardId,
      title: pkg.pinterestTitle,
      description: fullDescription,
      link: pkg.destinationUrl || undefined,
      imageUrl,
    });
    pinId = pin.id;
    pinUrl = pin.link ?? `https://pinterest.com/pin/${pin.id}/`;
  }

  await prisma.pinterestPublishingJob.update({
    where: { id: jobId },
    data: {
      status: "Published",
      pinterestPinId: pinId,
      pinterestPinUrl: pinUrl,
      finishedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
}

/** Marks a job as failed or schedules a retry. */
async function failJob(
  jobId: string,
  errorMessage: string,
  retryCount: number,
  retryLimit: number,
  isAuthError: boolean,
  isRateLimit: boolean,
): Promise<void> {
  const willRetry = !isAuthError && retryCount < retryLimit - 1;
  const backoff = Math.min(
    BASE_BACKOFF_MS * Math.pow(2, retryCount),
    30 * 60_000, // cap at 30 min
  );

  if (isAuthError) {
    // Mark account as requiring reconnection
    const job = await prisma.pinterestPublishingJob.findUnique({
      where: { id: jobId },
      select: { accountId: true },
    });
    if (job) {
      await prisma.pinterestAccount.update({
        where: { id: job.accountId },
        data: { status: "AuthenticationExpired" },
      });
      // Cancel all pending jobs for this account
      await prisma.pinterestPublishingJob.updateMany({
        where: {
          accountId: job.accountId,
          status: { in: ["Scheduled", "Pending", "RetryPending"] },
        },
        data: { status: "Cancelled", lastError: "Account requires reconnection." },
      });
    }
  }

  await prisma.pinterestPublishingJob.update({
    where: { id: jobId },
    data: {
      status: willRetry ? "RetryPending" : "Failed",
      retryCount: { increment: 1 },
      lastError: errorMessage.slice(0, 1000),
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: willRetry ? null : new Date(),
      availableAt: willRetry
        ? new Date(Date.now() + (isRateLimit ? backoff * 2 : backoff))
        : undefined,
    },
  });
}

/**
 * Main entry point called by the engine controller.
 * Returns count of jobs processed.
 */
export async function processDueJobs(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const settings = await getOrCreateEngineSettings();
  if (!settings.engineEnabled) return { processed: 0, succeeded: 0, failed: 0 };

  // Recover stale leases first
  await recoverStaleLeasedJobs();

  const workerId = randomUUID();
  const jobIds = await claimDueJobs(
    workerId,
    settings.workerConcurrency,
    settings.retryLimit,
  );

  if (jobIds.length === 0) return { processed: 0, succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;

  // Execute jobs sequentially to prevent headless browser session collisions and Pinterest rate limit issues
  for (const jobId of jobIds) {
    const job = await prisma.pinterestPublishingJob.findUnique({
      where: { id: jobId },
      select: { retryCount: true },
    });
    try {
      await executeJob(jobId);
      succeeded++;
    } catch (err) {
      failed++;
      const isAuth = err instanceof PinterestAuthError;
      const isRate = err instanceof PinterestRateLimitError;
      await failJob(
        jobId,
        err instanceof Error ? err.message : "Unknown error",
        job?.retryCount ?? 0,
        settings.retryLimit,
        isAuth,
        isRate,
      ).catch((e) => console.error("Failed to record job failure:", e));
    }
  }

  return { processed: jobIds.length, succeeded, failed };
}

