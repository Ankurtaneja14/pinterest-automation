import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createPublishingJobs,
  approveJobs,
  cancelJobs,
  rescheduleJob,
  listJobs,
  getJobStats,
} from "./job-service";

describe("Pinterest Job Service", () => {
  let testAccountId: string;
  let testBoardId: string;
  let testPackageId: string;

  beforeEach(async () => {
    // Ensure test account exists
    const account = await prisma.pinterestAccount.upsert({
      where: { pinterestUserId: "test-user-job-service" },
      update: {},
      create: {
        pinterestUserId: "test-user-job-service",
        username: "testuserjob",
        displayName: "Test User Job",
        accessTokenEncrypted: "enc-token",
        status: "Connected",
      },
    });
    testAccountId = account.id;

    // Ensure test board exists
    const board = await prisma.pinterestBoard.upsert({
      where: {
        accountId_pinterestBoardId: {
          accountId: testAccountId,
          pinterestBoardId: "board-12345",
        },
      },
      update: {},
      create: {
        accountId: testAccountId,
        pinterestBoardId: "board-12345",
        name: "Test Board",
      },
    });
    testBoardId = board.id;

    // Find or create an existing ContentPackage
    let pkg = await prisma.contentPackage.findFirst();
    if (!pkg) {
      // Find or create schedule & execution & idea
      const sched = await prisma.nicheSchedule.create({
        data: {
          scheduleKey: `test-key-${Date.now()}`,
          niche: "Test Niche",
          executionDate: new Date(),
          targetCountry: "US",
          targetAudience: "General",
          language: "en",
          researchIdeasCount: 5,
          pinsToGenerate: 3,
          destinationUrl: "https://example.com",
        },
      });
      const exec = await prisma.executionJob.create({
        data: {
          scheduleId: sched.id,
          idempotencyKey: `exec-${Date.now()}`,
        },
      });
      const idea = await prisma.contentIdea.create({
        data: {
          executionId: exec.id,
          ideaKey: `idea-${Date.now()}`,
          title: "Test Idea",
          coreConcept: "Concept",
          explanation: "Explanation",
          audienceSegment: "All",
          audienceNeed: "Need",
          searchIntent: "Intent",
          keywordsJson: "[]",
          rationale: "Rationale",
          sourceReferencesJson: "[]",
          visualDirection: "Direction",
          contentFormat: "Standard Pin",
          trendClassification: "Trending",
          destinationRelevance: "High",
        },
      });
      pkg = await prisma.contentPackage.create({
        data: {
          contentId: `pkg-${Date.now()}`,
          ideaId: idea.id,
          pinterestTitle: "Sample Pin Title",
          description: "Sample Description",
          hashtagsJson: "[]",
          keywordsJson: "[]",
          imagePrompt: "An aesthetic pin",
          destinationUrl: "https://example.com/test",
          generationStatus: "Complete",
        },
      });
    }
    testPackageId = pkg.id;
  });

  afterEach(async () => {
    // Clean up created jobs
    await prisma.pinterestPublishingJob.deleteMany({
      where: { accountId: testAccountId },
    });
    await prisma.pinterestBoard.deleteMany({
      where: { accountId: testAccountId },
    });
    await prisma.pinterestAccount.deleteMany({
      where: { id: testAccountId },
    });
  });

  it("creates independent publishing jobs for content × account pairs", async () => {
    const scheduledAt = new Date(Date.now() + 3600_000);
    const count = await createPublishingJobs({
      contentPackageIds: [testPackageId],
      accountBoardPairs: [{ accountId: testAccountId, boardId: testBoardId }],
      scheduledAt,
    });

    expect(count).toBe(1);

    const jobs = await prisma.pinterestPublishingJob.findMany({
      where: { contentPackageId: testPackageId, accountId: testAccountId },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("Draft");
    expect(jobs[0].approvalStatus).toBe("AwaitingApproval");
    expect(jobs[0].boardId).toBe(testBoardId);
  });

  it("prevents duplicate job creation when one is already pending or scheduled", async () => {
    const scheduledAt = new Date(Date.now() + 3600_000);
    const count1 = await createPublishingJobs({
      contentPackageIds: [testPackageId],
      accountBoardPairs: [{ accountId: testAccountId, boardId: testBoardId }],
      scheduledAt,
    });
    expect(count1).toBe(1);

    // Second call with same combo should skip creation
    const count2 = await createPublishingJobs({
      contentPackageIds: [testPackageId],
      accountBoardPairs: [{ accountId: testAccountId, boardId: testBoardId }],
      scheduledAt,
    });
    expect(count2).toBe(0);
  });

  it("approves jobs and transitions status from Draft to Scheduled", async () => {
    const scheduledAt = new Date(Date.now() + 3600_000);
    await createPublishingJobs({
      contentPackageIds: [testPackageId],
      accountBoardPairs: [{ accountId: testAccountId, boardId: testBoardId }],
      scheduledAt,
    });

    const draftJobs = await prisma.pinterestPublishingJob.findMany({
      where: { accountId: testAccountId },
    });
    expect(draftJobs[0].status).toBe("Draft");

    const approvedCount = await approveJobs([draftJobs[0].id]);
    expect(approvedCount).toBe(1);

    const updated = await prisma.pinterestPublishingJob.findUnique({
      where: { id: draftJobs[0].id },
    });
    expect(updated?.status).toBe("Scheduled");
    expect(updated?.approvalStatus).toBe("Approved");
  });

  it("cancels jobs cleanly", async () => {
    const scheduledAt = new Date(Date.now() + 3600_000);
    await createPublishingJobs({
      contentPackageIds: [testPackageId],
      accountBoardPairs: [{ accountId: testAccountId, boardId: testBoardId }],
      scheduledAt,
    });

    const draftJobs = await prisma.pinterestPublishingJob.findMany({
      where: { accountId: testAccountId },
    });
    const cancelledCount = await cancelJobs([draftJobs[0].id]);
    expect(cancelledCount).toBe(1);

    const updated = await prisma.pinterestPublishingJob.findUnique({
      where: { id: draftJobs[0].id },
    });
    expect(updated?.status).toBe("Cancelled");
  });

  it("reschedules jobs to a new time", async () => {
    const scheduledAt = new Date(Date.now() + 3600_000);
    await createPublishingJobs({
      contentPackageIds: [testPackageId],
      accountBoardPairs: [{ accountId: testAccountId, boardId: testBoardId }],
      scheduledAt,
    });

    const draftJobs = await prisma.pinterestPublishingJob.findMany({
      where: { accountId: testAccountId },
    });
    const newDate = new Date(Date.now() + 7200_000);
    await rescheduleJob(draftJobs[0].id, newDate);

    const updated = await prisma.pinterestPublishingJob.findUnique({
      where: { id: draftJobs[0].id },
    });
    expect(updated?.scheduledAt.getTime()).toBe(newDate.getTime());
  });

  it("calculates job statistics accurately", async () => {
    const stats = await getJobStats();
    expect(stats).toHaveProperty("Draft");
    expect(stats).toHaveProperty("Scheduled");
    expect(stats).toHaveProperty("Published");
    expect(stats).toHaveProperty("Failed");
  });
});

