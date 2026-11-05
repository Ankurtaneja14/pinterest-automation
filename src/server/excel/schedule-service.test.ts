import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { createScheduleKey, type ScheduleImportRow } from "./schedule-import";
import { importSchedules } from "./schedule-service";
import {
  enqueueResearch,
  processResearchSession,
} from "../research/research-persistence";
import {
  enqueueIdeaGeneration,
  processIdeaGeneration,
} from "../ideas/idea-persistence";
import {
  enqueueIdeaScoring,
  processIdeaScoring,
} from "../ideas/scoring-persistence";
import type { IdeaScoreEntry } from "../ideas/idea-scoring";
import {
  enqueueContentGeneration,
  processContentGeneration,
} from "../content/content-persistence";
import type { ContentDraft } from "../content/content-generation";
import type {
  ResearchReport,
  ResearchSearchResult,
} from "../research/schemas";
import type { IdeaDraft } from "../ideas/idea-schema";
import {
  prepareGeneratedImage,
  saveGeneratedImage,
} from "../images/image-persistence";

let testDirectory: string;
let storageDirectory: string;
let databaseFile: string;
let database: PrismaClient;
let previousStorageRoot: string | undefined;

beforeAll(async () => {
  testDirectory = await mkdtemp(path.join(os.tmpdir(), "pce-schedule-db-"));
  storageDirectory = path.join(testDirectory, "storage");
  databaseFile = path.join(
    process.cwd(),
    "prisma",
    `schedule-test-${randomUUID()}.db`,
  );
  const databaseUrl = `file:./${path.basename(databaseFile)}`;
  previousStorageRoot = process.env.STORAGE_ROOT;
  process.env.STORAGE_ROOT = storageDirectory;

  execFileSync(
    process.execPath,
    [
      path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
      "migrate",
      "deploy",
      "--schema",
      path.join(process.cwd(), "prisma", "schema.prisma"),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    },
  );

  database = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  await database.$connect();
}, 60_000);

afterAll(async () => {
  if (database) {
    await database.$disconnect();
  }
  if (previousStorageRoot === undefined) {
    delete process.env.STORAGE_ROOT;
  } else {
    process.env.STORAGE_ROOT = previousStorageRoot;
  }
  await Promise.all([
    rm(testDirectory, { recursive: true, force: true }),
    rm(databaseFile, { force: true }),
    rm(`${databaseFile}-journal`, { force: true }),
  ]);
});

describe("importSchedules", () => {
  it("persists imports idempotently and keeps completed schedules unchanged", async () => {
    const identity = {
      niche: `Database Import ${randomUUID()}`,
      executionDate: "2026-11-03",
      targetCountry: "USA",
      targetAudience: "Gen Z",
      language: "English",
      destinationUrl: "https://example.com/database-import",
    };
    const row: ScheduleImportRow = {
      ...identity,
      researchIdeasCount: 30,
      pinsToGenerate: 8,
      status: "Pending",
      scheduleKey: createScheduleKey(identity),
      sourceRow: 2,
    };
    const workbook = Buffer.from("persisted workbook fixture");

    const first = await importSchedules(workbook, [row], database);
    const second = await importSchedules(workbook, [row], database);
    const saved = await database.nicheSchedule.findUniqueOrThrow({
      where: { scheduleKey: row.scheduleKey },
    });

    expect(first.imported).toBe(1);
    expect(second).toMatchObject({ imported: 0, updated: 1, skipped: 0 });
    expect(
      await database.nicheSchedule.count({
        where: { scheduleKey: row.scheduleKey },
      }),
    ).toBe(1);
    expect(
      await database.workbookUpload.count({
        where: {
          relativePath: {
            in: [first.workbookRelativePath, second.workbookRelativePath],
          },
        },
      }),
    ).toBe(2);
    expect(
      await stat(
        path.join(storageDirectory, ...first.workbookRelativePath.split("/")),
      ),
    ).toMatchObject({ size: workbook.byteLength });

    await database.nicheSchedule.update({
      where: { id: saved.id },
      data: { status: "Completed" },
    });
    const completedImport = await importSchedules(workbook, [row], database);
    const completed = await database.nicheSchedule.findUniqueOrThrow({
      where: { scheduleKey: row.scheduleKey },
    });

    expect(completedImport).toMatchObject({ imported: 0, updated: 0, skipped: 1 });
    expect(completed.status).toBe("Completed");

    await database.nicheSchedule.deleteMany({
      where: { scheduleKey: row.scheduleKey },
    });
    await database.workbookUpload.deleteMany({
      where: {
        relativePath: {
          in: [
            first.workbookRelativePath,
            second.workbookRelativePath,
            completedImport.workbookRelativePath,
          ],
        },
      },
    });
    for (const relativePath of [
      first.workbookRelativePath,
      second.workbookRelativePath,
      completedImport.workbookRelativePath,
    ]) {
      await rm(
        path.join(storageDirectory, ...relativePath.split("/")),
        { force: true },
      );
    }

    expect(await stat(databaseFile)).toBeDefined();
  }, 20_000);
});

async function createResearchSchedule(niche: string) {
  return database.nicheSchedule.create({
    data: {
      scheduleKey: createScheduleKey({
        niche,
        executionDate: "2026-11-03",
        targetCountry: "United States",
        targetAudience: "Apartment renters",
        language: "English",
      }),
      niche,
      executionDate: new Date("2026-11-03T00:00:00.000Z"),
      targetCountry: "United States",
      targetAudience: "Apartment renters",
      language: "English",
      researchIdeasCount: 20,
      pinsToGenerate: 5,
      destinationUrl: "https://example.com/organization",
    },
  });
}

function makeIdeaDraft(index: number): IdeaDraft {
  return {
    title: `Distinct renter storage concept ${index}`,
    coreConcept: `A practical renter organization concept number ${index}.`,
    explanation: `Explain how to apply the renter storage concept number ${index} at home.`,
    audienceSegment: "Apartment renters",
    audienceNeed: "Make limited storage easier to use.",
    searchIntent: "informational",
    keywords: ["renter storage", "small apartment", `organization idea ${index}`],
    rationale: `The saved source evidence supports this specific concept ${index}.`,
    visualDirection: `Show a bright compact apartment with a clear storage layout ${index}.`,
    contentFormat: "Step-by-step guide",
    trendClassification: "evergreen",
    destinationRelevance: `This concept relates to the scheduled destination page ${index}.`,
    sourceRefs: ["S1"],
  };
}

function makeContentDraft(ideaId: string): ContentDraft {
  return {
    ideaId,
    pinterestTitle: `Renter storage guide for idea ${ideaId}`,
    description:
      "Use this practical renter-friendly storage guide to make a small apartment feel more organized. Visit the scheduled destination to explore the topic further.",
    hashtags: ["#RenterTips", "#SmallSpace", "#StorageIdeas"],
    keywords: ["renter storage ideas", "small apartment organization", "space saving tips"],
    imagePrompt:
      "Create a vertical Pinterest pin showing a bright compact apartment with an organized shelf, clean editorial typography, warm neutral palette, soft natural lighting, and generous readable safe margins.",
  };
}

describe("research persistence", () => {
  function makeSources(query: string): ResearchSearchResult[] {
    return [1, 2, 3].map((id) => ({
      title: `Research source ${id}`,
      url: `https://research-${id}.example/article`,
      canonicalUrl: `https://research-${id}.example/article`,
      publishedAt: null,
      excerpt: `Research source ${id} excerpt contains evidence for storage needs and renter-friendly organization.`,
      query,
    }));
  }

  function makeReport(): ResearchReport {
    const cited = {
      sourceRefs: ["S1"],
      text: "Evidence supports this research finding.",
    };
    return {
      overview: cited,
      keyFindings: [cited, cited, cited],
      audienceInsights: [cited, cited],
      searchOpportunities: [
        {
          query: "small-space storage",
          intent: "informational",
          rationale: "Evidence supports this search opportunity for renters.",
          sourceRefs: ["S1"],
        },
        {
          query: "closet ideas",
          intent: "inspirational",
          rationale: "Evidence supports this search opportunity for renters.",
          sourceRefs: ["S2"],
        },
        {
          query: "renter organization",
          intent: "commercial",
          rationale: "Evidence supports this search opportunity for renters.",
          sourceRefs: ["S3"],
        },
      ],
      contentAngles: [
        {
          angle: "Create a renter-friendly storage plan",
          format: "Checklist",
          rationale: "Evidence supports this practical approach for renters.",
          sourceRefs: ["S1"],
        },
        {
          angle: "Organize a compact closet",
          format: "Guide",
          rationale: "Evidence supports this practical approach for renters.",
          sourceRefs: ["S2"],
        },
        {
          angle: "Use vertical storage in small homes",
          format: "Idea list",
          rationale: "Evidence supports this practical approach for renters.",
          sourceRefs: ["S3"],
        },
      ],
    };
  }

  it("persists research sources and links every report citation to a stored source", async () => {
    const schedule = await createResearchSchedule(`Research ${randomUUID()}`);
    const queued = await enqueueResearch(schedule.id, database);
    const duplicate = await enqueueResearch(schedule.id, database);

    expect(duplicate).toEqual({ sessionId: queued.sessionId, alreadyRunning: true });

    const config = {
      stage: "research" as const,
      providerName: "Test provider",
      baseUrl: "https://api.example.com/v1",
      accountId: null,
      apiKey: "test-secret",
      modelName: "test-model",
      temperature: 0.7,
      maxOutputTokens: 4096,
      requestTimeoutMs: 60_000,
      retryLimit: 0,
    };
    await processResearchSession(queued.sessionId, {
      database,
      searchProvider: {
        search: async (query) => makeSources(query),
      },
      synthesisProvider: {
        generate: async () => makeReport(),
      },
      getAIConfiguration: async () => config,
    });

    const saved = await database.researchSession.findUniqueOrThrow({
      where: { id: queued.sessionId },
      include: { sources: true, execution: true },
    });
    const storedReport = JSON.parse(saved.reportJson ?? "{}") as {
      overview: { sourceIds: string[] };
      keyFindings: Array<{ sourceIds: string[] }>;
      audienceInsights: Array<{ sourceIds: string[] }>;
      searchOpportunities: Array<{ sourceIds: string[] }>;
      contentAngles: Array<{ sourceIds: string[] }>;
    };
    const sourceIds = new Set(saved.sources.map((source) => source.id));
    const allCitations = [
      ...storedReport.overview.sourceIds,
      ...storedReport.keyFindings.flatMap((item) => item.sourceIds),
      ...storedReport.audienceInsights.flatMap((item) => item.sourceIds),
      ...storedReport.searchOpportunities.flatMap((item) => item.sourceIds),
      ...storedReport.contentAngles.flatMap((item) => item.sourceIds),
    ];

    expect(saved.status).toBe("Complete");
    expect(saved.sources).toHaveLength(3);
    expect(saved.execution.status).toBe("ResearchComplete");
    expect(allCitations.length).toBeGreaterThan(0);
    expect(allCitations.every((sourceId) => sourceIds.has(sourceId))).toBe(true);

    await database.executionJob.delete({ where: { id: saved.executionId } });
    await database.nicheSchedule.delete({ where: { id: schedule.id } });
  });

  it("records retrieval failure in session and execution state", async () => {
    const schedule = await createResearchSchedule(`Research failure ${randomUUID()}`);
    const queued = await enqueueResearch(schedule.id, database);

    await expect(
      processResearchSession(queued.sessionId, {
        database,
        searchProvider: { search: async () => [] },
        getAIConfiguration: async () => {
          throw new Error("AI should not be called when search has no sources.");
        },
      }),
    ).rejects.toThrow("Public search did not return any usable sources.");

    const saved = await database.researchSession.findUniqueOrThrow({
      where: { id: queued.sessionId },
      include: { execution: true },
    });
    expect(saved.status).toBe("Failed");
    expect(saved.execution.status).toBe("ResearchFailed");
    expect(saved.execution.errorCategory).toBe("retrieval");

    await database.executionJob.delete({ where: { id: saved.executionId } });
    await database.nicheSchedule.delete({ where: { id: schedule.id } });
  });

  it("records AI configuration failure as a configuration error", async () => {
    const schedule = await createResearchSchedule(`Research config ${randomUUID()}`);
    const queued = await enqueueResearch(schedule.id, database);

    await expect(
      processResearchSession(queued.sessionId, {
        database,
        searchProvider: { search: async (query) => makeSources(query) },
        getAIConfiguration: async () => {
          throw new Error("Save and enable the research configuration first.");
        },
      }),
    ).rejects.toThrow("Save and enable the research configuration first.");

    const saved = await database.researchSession.findUniqueOrThrow({
      where: { id: queued.sessionId },
      include: { execution: true },
    });
    expect(saved.status).toBe("Failed");
    expect(saved.execution.status).toBe("ResearchFailed");
    expect(saved.execution.errorCategory).toBe("configuration");

    await database.executionJob.delete({ where: { id: saved.executionId } });
    await database.nicheSchedule.delete({ where: { id: schedule.id } });
  });
});

describe("idea generation persistence", () => {
  it("recovers a stale background run so it can be safely retried", async () => {
    const schedule = await createResearchSchedule(`Stale ideas ${randomUUID()}`);
    const research = await enqueueResearch(schedule.id, database);
    await database.researchSession.update({
      where: { id: research.sessionId },
      data: { status: "Complete", reportJson: JSON.stringify({ overview: "Research." }) },
    });
    const execution = await database.executionJob.findUniqueOrThrow({
      where: { id: (await database.researchSession.findUniqueOrThrow({
        where: { id: research.sessionId },
        select: { executionId: true },
      })).executionId },
      select: { id: true },
    });
    await database.executionJob.update({
      where: { id: execution.id },
      data: {
        status: "IdeasGenerating",
        updatedAt: new Date(Date.now() - 9 * 60 * 1000),
      },
    });

    const queued = await enqueueIdeaGeneration(schedule.id, database);
    const saved = await database.executionJob.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(queued.alreadyRunning).toBe(false);
    expect(saved.status).toBe("IdeasGenerating");
    expect(
      await database.executionLog.count({
        where: {
          executionId: execution.id,
          event: "idea_generation_stale_recovered",
        },
      }),
    ).toBe(1);

    await database.executionJob.delete({ where: { id: execution.id } });
    await database.nicheSchedule.delete({ where: { id: schedule.id } });
  });

  it("persists the requested distinct ideas with valid stored-source citations", async () => {
    const schedule = await createResearchSchedule(`Idea generation ${randomUUID()}`);
    const research = await enqueueResearch(schedule.id, database);
    await database.researchSession.update({
      where: { id: research.sessionId },
      data: { status: "Complete", reportJson: JSON.stringify({ overview: { text: "Evidence." } }) },
    });
    const source = await database.researchSource.create({
      data: {
        researchSessionId: research.sessionId,
        canonicalUrl: "https://ideas.example/source",
        sourceUrl: "https://ideas.example/source",
        title: "Evidence source",
        excerpt: "Evidence excerpt supporting renter organization ideas and storage.",
      },
    });
    const queued = await enqueueIdeaGeneration(schedule.id, database);
    const duplicate = await enqueueIdeaGeneration(schedule.id, database);
    expect(queued).toMatchObject({
      researchSessionId: research.sessionId,
      alreadyRunning: false,
      alreadyComplete: false,
    });
    expect(duplicate.alreadyRunning).toBe(true);

    let next = 1;
    await processIdeaGeneration(research.sessionId, {
      database,
      getAIConfiguration: async () => ({
        stage: "idea_generation",
        providerName: "Test provider",
        baseUrl: "https://api.example.com/v1",
        accountId: null,
        apiKey: "test-secret",
        modelName: "test-model",
        temperature: 0.7,
        maxOutputTokens: 4096,
        requestTimeoutMs: 60_000,
        retryLimit: 0,
      }),
      provider: {
        generate: async (_systemPrompt, _userPrompt, count) => ({
          ideas: Array.from({ length: count }, () => makeIdeaDraft(next++)),
        }),
      },
    });

    const saved = await database.contentIdea.findMany({
      where: { executionId: (await database.researchSession.findUniqueOrThrow({
        where: { id: research.sessionId },
        select: { executionId: true },
      })).executionId },
      orderBy: { createdAt: "asc" },
    });
    const keys = new Set(saved.map((idea) => idea.ideaKey));
    const citations = saved.flatMap((idea) =>
      JSON.parse(idea.sourceReferencesJson) as string[],
    );
    expect(saved).toHaveLength(20);
    expect(keys.size).toBe(20);
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.every((sourceId) => sourceId === source.id)).toBe(true);
    expect((await enqueueIdeaGeneration(schedule.id, database)).alreadyComplete).toBe(
      true,
    );

    const executionId = saved[0].executionId;
    expect(await enqueueIdeaScoring(research.sessionId, database)).toEqual({
      alreadyRunning: false,
      alreadyComplete: false,
    });
    expect((await enqueueIdeaScoring(research.sessionId, database)).alreadyRunning).toBe(
      true,
    );
    await processIdeaScoring(research.sessionId, {
      database,
      getAIConfiguration: async () => ({
        stage: "idea_evaluation",
        providerName: "Test provider",
        baseUrl: "https://api.example.com/v1",
        accountId: null,
        apiKey: "test-secret",
        modelName: "test-model",
        temperature: 0.7,
        maxOutputTokens: 4096,
        requestTimeoutMs: 60_000,
        retryLimit: 0,
      }),
      scoreProvider: {
        score: async (_systemPrompt, _userPrompt, ideaIds) => ({
          scores: ideaIds.map((ideaId, index): IdeaScoreEntry => ({
            ideaId,
            trendRelevance: 7 + (index % 4),
            audienceResonance: 8,
            searchPotential: 9,
            clickPotential: 7,
            visualAppeal: 8,
            originality: 6 + (index % 5),
            evergreenValue: 8,
            reasoning: "The idea has clear audience value and evidence-supported relevance.",
            strengths: ["Clear audience need"],
            weaknesses: ["Could be more specific"],
            improvementSuggestions: ["Name a concrete use case"],
          })),
        }),
      },
    });
    const scored = await database.contentIdea.findMany({
      where: { executionId },
      include: { score: true, selection: true },
    });
    expect(scored.every((idea) => idea.score !== null)).toBe(true);
    expect(scored.filter((idea) => idea.selection?.selected)).toHaveLength(5);
    expect(new Set(scored.map((idea) => idea.selection?.rank)).size).toBe(20);
    expect(
      (await database.executionJob.findUniqueOrThrow({
        where: { id: executionId },
        select: { status: true },
      })).status,
    ).toBe("Scored");
    expect(
      (await enqueueIdeaScoring(research.sessionId, database)).alreadyComplete,
    ).toBe(true);

    expect(await enqueueContentGeneration(research.sessionId, database)).toEqual({
      alreadyRunning: false,
      alreadyComplete: false,
    });
    expect(
      (await enqueueContentGeneration(research.sessionId, database)).alreadyRunning,
    ).toBe(true);
    let contentBatch = 0;
    await expect(
      processContentGeneration(research.sessionId, {
        database,
        getAIConfiguration: async () => ({
          stage: "content_generation",
          providerName: "Test provider",
          baseUrl: "https://api.example.com/v1",
          accountId: null,
          apiKey: "test-secret",
          modelName: "test-model",
          temperature: 0.7,
          maxOutputTokens: 4096,
          requestTimeoutMs: 60_000,
          retryLimit: 0,
        }),
        provider: {
          generate: async (_systemPrompt, _userPrompt, ideaIds) => {
            contentBatch += 1;
            if (contentBatch === 2) {
              throw new Error("Temporary provider failure.");
            }
            return { packages: ideaIds.map(makeContentDraft) };
          },
        },
      }),
    ).rejects.toThrow("Temporary provider failure.");
    expect(
      await database.contentPackage.count({
        where: { idea: { executionId }, generationStatus: "Complete" },
      }),
    ).toBe(3);
    expect(
      (await database.executionJob.findUniqueOrThrow({
        where: { id: executionId },
        select: { status: true },
      })).status,
    ).toBe("ContentFailed");
    expect(await enqueueContentGeneration(research.sessionId, database)).toEqual({
      alreadyRunning: false,
      alreadyComplete: false,
    });
    const retryIdeaIds: string[][] = [];
    await processContentGeneration(research.sessionId, {
      database,
      getAIConfiguration: async () => ({
        stage: "content_generation",
        providerName: "Test provider",
        baseUrl: "https://api.example.com/v1",
        accountId: null,
        apiKey: "test-secret",
        modelName: "test-model",
        temperature: 0.7,
        maxOutputTokens: 4096,
        requestTimeoutMs: 60_000,
        retryLimit: 0,
      }),
      provider: {
        generate: async (_systemPrompt, _userPrompt, ideaIds) => {
          retryIdeaIds.push(ideaIds);
          return { packages: ideaIds.map(makeContentDraft) };
        },
      },
    });
    const packages = await database.contentPackage.findMany({
      where: { idea: { executionId } },
      include: { idea: true },
    });
    expect(packages).toHaveLength(5);
    expect(packages.every((item) => item.generationStatus === "Complete")).toBe(true);
    expect(packages.every((item) => item.destinationUrl === schedule.destinationUrl)).toBe(true);
    expect(new Set(packages.map((item) => item.ideaId)).size).toBe(5);
    expect(retryIdeaIds.flat()).toHaveLength(2);
    expect(
      (await database.executionJob.findUniqueOrThrow({
        where: { id: executionId },
        select: { status: true },
      })).status,
    ).toBe("ContentGenerated");
    expect(
      (await enqueueContentGeneration(research.sessionId, database)).alreadyComplete,
    ).toBe(true);

    const imageBytes = await sharp({
      create: {
        width: 900,
        height: 1200,
        channels: 3,
        background: "#2d7159",
      },
    })
      .png()
      .toBuffer();
    const selectedIdeas = scored.filter((idea) => idea.selection?.selected);
    await expect(
      saveGeneratedImage(
        research.sessionId,
        scored.find((idea) => !idea.selection?.selected)!.id,
        imageBytes,
        database,
      ),
    ).rejects.toThrow("selected idea");
    const firstUpload = await saveGeneratedImage(
      research.sessionId,
      selectedIdeas[0].id,
      imageBytes,
      database,
    );
    const repeatedUpload = await saveGeneratedImage(
      research.sessionId,
      selectedIdeas[0].id,
      imageBytes,
      database,
    );
    expect(repeatedUpload.assetId).toBe(firstUpload.assetId);
    const generationClaim = await prepareGeneratedImage(
      research.sessionId,
      selectedIdeas[0].id,
      database,
    );
    await expect(
      prepareGeneratedImage(research.sessionId, selectedIdeas[0].id, database),
    ).rejects.toThrow("already being generated");
    const generatedImage = await saveGeneratedImage(
      research.sessionId,
      selectedIdeas[0].id,
      imageBytes,
      database,
      "gemini-assisted",
      generationClaim,
    );
    expect(generatedImage.assetId).toBe(firstUpload.assetId);
    const generatedMetadata = await database.generatedAsset.findUniqueOrThrow({
      where: { id: generatedImage.assetId },
      select: { validationJson: true },
    });
    expect(JSON.parse(generatedMetadata.validationJson ?? "{}")).toMatchObject({
      source: "gemini-assisted",
      status: "valid",
    });
    await expect(
      saveGeneratedImage(
        research.sessionId,
        selectedIdeas[1].id,
        Buffer.from("not an image"),
        database,
      ),
    ).rejects.toThrow("unreadable or unsupported");
    for (const idea of selectedIdeas.slice(1)) {
      await saveGeneratedImage(research.sessionId, idea.id, imageBytes, database);
    }
    const generatedAssets = await database.generatedAsset.findMany({
      where: { executionId },
    });
    expect(generatedAssets).toHaveLength(5);
    expect(generatedAssets.every((asset) => asset.status === "Complete")).toBe(true);
    expect(generatedAssets.every((asset) => asset.format === "webp")).toBe(true);
    expect(generatedAssets.every((asset) => asset.width === 900)).toBe(true);
    expect(generatedAssets.every((asset) => asset.height === 1200)).toBe(true);
    await database.executionJob.delete({ where: { id: executionId } });
    await database.nicheSchedule.delete({ where: { id: schedule.id } });
  });
});
