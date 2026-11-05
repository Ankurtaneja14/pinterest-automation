/**
 * Publishing job service — creates, approves, and manages jobs.
 */
import { prisma } from "@/lib/prisma";

export type JobStatus =
  | "Draft"
  | "AwaitingApproval"
  | "Scheduled"
  | "Pending"
  | "Processing"
  | "Published"
  | "Failed"
  | "RetryPending"
  | "Cancelled";

export interface CreateJobsInput {
  contentPackageIds: string[];
  accountBoardPairs: { accountId: string; boardId: string }[];
  scheduledAt: Date;
}

/**
 * Creates one publishing job per content × account pair.
 * Returns the total number of jobs created.
 */
export async function createPublishingJobs(input: CreateJobsInput): Promise<number> {
  let count = 0;
  for (const contentPackageId of input.contentPackageIds) {
    for (const { accountId, boardId } of input.accountBoardPairs) {
      // Idempotency: skip if a non-terminal job already exists for this combo
      const existing = await prisma.pinterestPublishingJob.findFirst({
        where: {
          contentPackageId,
          accountId,
          status: { notIn: ["Published", "Failed", "Cancelled"] },
        },
      });
      if (existing) continue;

      await prisma.pinterestPublishingJob.create({
        data: {
          contentPackageId,
          accountId,
          boardId,
          scheduledAt: input.scheduledAt,
          approvalStatus: "AwaitingApproval",
          status: "Draft",
          availableAt: input.scheduledAt,
        },
      });
      count += 1;
    }
  }
  return count;
}

/**
 * Approve a batch of jobs → moves them to Scheduled.
 */
export async function approveJobs(jobIds: string[]): Promise<number> {
  const result = await prisma.pinterestPublishingJob.updateMany({
    where: {
      id: { in: jobIds },
      approvalStatus: "AwaitingApproval",
      status: "Draft",
    },
    data: { approvalStatus: "Approved", status: "Scheduled" },
  });
  return result.count;
}

/**
 * Cancel jobs (only Draft / Scheduled / Pending allowed).
 */
export async function cancelJobs(jobIds: string[]): Promise<number> {
  const result = await prisma.pinterestPublishingJob.updateMany({
    where: {
      id: { in: jobIds },
      status: { in: ["Draft", "Scheduled", "Pending"] },
    },
    data: { status: "Cancelled" },
  });
  return result.count;
}

/**
 * Update schedule time for a Draft/Scheduled job.
 */
export async function rescheduleJob(jobId: string, scheduledAt: Date): Promise<void> {
  await prisma.pinterestPublishingJob.update({
    where: { id: jobId, status: { in: ["Draft", "Scheduled"] } },
    data: { scheduledAt, availableAt: scheduledAt },
  });
}

export interface JobListFilter {
  accountId?: string;
  contentPackageId?: string;
  status?: JobStatus;
  approvalStatus?: string;
  page?: number;
  pageSize?: number;
}

export async function listJobs(filter: JobListFilter = {}) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 50;
  const skip = (page - 1) * pageSize;

  const where = {
    ...(filter.accountId ? { accountId: filter.accountId } : {}),
    ...(filter.contentPackageId ? { contentPackageId: filter.contentPackageId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.approvalStatus ? { approvalStatus: filter.approvalStatus } : {}),
  };

  const [jobs, total] = await prisma.$transaction([
    prisma.pinterestPublishingJob.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      skip,
      take: pageSize,
      include: {
        account: {
          select: { id: true, username: true, displayName: true, profileImage: true, status: true },
        },
        board: {
          select: { id: true, name: true, pinterestBoardId: true },
        },
        contentPackage: {
          select: {
            id: true,
            pinterestTitle: true,
            description: true,
            destinationUrl: true,
            assets: {
              where: { status: "Complete" },
              take: 1,
              select: { id: true, status: true },
            },
          },
        },
      },
    }),
    prisma.pinterestPublishingJob.count({ where }),
  ]);

  return { jobs, total, page, pageSize };
}

export async function getJobStats() {
  const statuses: JobStatus[] = [
    "Draft", "AwaitingApproval", "Scheduled", "Pending",
    "Processing", "Published", "Failed", "RetryPending", "Cancelled",
  ];

  const counts = await prisma.pinterestPublishingJob.groupBy({
    by: ["status"],
    _count: { id: true },
  });

  const result: Record<string, number> = {};
  for (const s of statuses) result[s] = 0;
  for (const row of counts) result[row.status] = row._count.id;
  return result;
}

