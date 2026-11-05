import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAIConfigurationForStage } from "@/server/ai/configuration";
import { AIProviderError } from "@/server/ai/openai-compatible";
import { searchBingRss } from "./bing-search";
import {
  createAISynthesisProvider,
  retrieveResearchSources,
  researchReportForStorage,
  synthesizeResearchReport,
  validateResearchCitations,
  type ResearchSearchProvider,
  type ResearchSynthesisProvider,
} from "./research-service";

type Database = Pick<
  PrismaClient,
  | "$transaction"
  | "nicheSchedule"
  | "executionJob"
  | "researchSession"
  | "researchSource"
>;

export class ResearchSessionError extends Error {
  constructor(
    message: string,
    readonly category: "schedule" | "retrieval" | "configuration" | "synthesis" | "persistence",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ResearchSessionError";
  }
}

export async function enqueueResearch(
  scheduleId: string,
  database: Database = prisma,
): Promise<{ sessionId: string; alreadyRunning: boolean }> {
  const schedule = await database.nicheSchedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, scheduleKey: true },
  });
  if (!schedule) {
    throw new ResearchSessionError("The requested schedule was not found.", "schedule", 404);
  }

  return database.$transaction(async (transaction) => {
    const existing = await transaction.executionJob.findUnique({
      where: { idempotencyKey: `research:${schedule.scheduleKey}` },
      select: { id: true },
    });
    if (existing) {
      const active = await transaction.researchSession.findFirst({
        where: {
          executionId: existing.id,
          status: { in: ["Pending", "Running"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (active) {
        return { sessionId: active.id, alreadyRunning: true };
      }
    }

    const execution = await transaction.executionJob.upsert({
      where: { idempotencyKey: `research:${schedule.scheduleKey}` },
      create: {
        scheduleId: schedule.id,
        idempotencyKey: `research:${schedule.scheduleKey}`,
        status: "ResearchQueued",
        stage: "Research",
      },
      update: {
        status: "ResearchQueued",
        stage: "Research",
        progress: 0,
        errorCategory: null,
        errorMessage: null,
        attemptCount: { increment: 1 },
      },
    });

    const session = await transaction.researchSession.create({
      data: { executionId: execution.id, status: "Pending" },
      select: { id: true },
    });
    return { sessionId: session.id, alreadyRunning: false };
  });
}

export async function processResearchSession(
  sessionId: string,
  options: {
    database?: Database;
    searchProvider?: ResearchSearchProvider;
    synthesisProvider?: ResearchSynthesisProvider;
    getAIConfiguration?: typeof getAIConfigurationForStage;
  } = {},
): Promise<void> {
  const database = options.database ?? prisma;
  try {
    const session = await database.researchSession.findUnique({
      where: { id: sessionId },
      include: { execution: { include: { schedule: true } } },
    });
    if (!session) {
      throw new ResearchSessionError("Research session was not found.", "schedule", 404);
    }
    if (session.status === "Complete") {
      return;
    }

    await database.$transaction(async (transaction) => {
      await transaction.researchSession.update({
        where: { id: session.id },
        data: { status: "Running", startedAt: new Date(), finishedAt: null },
      });
      await transaction.executionJob.update({
        where: { id: session.executionId },
        data: {
          status: "Researching",
          stage: "Research",
          progress: 5,
          errorCategory: null,
          errorMessage: null,
        },
      });
    });

    const schedule = session.execution.schedule;
    const retrieval = await retrieveResearchSources(
      schedule,
      options.searchProvider ?? { search: searchBingRss },
    );
    await database.researchSource.createMany({
      data: retrieval.sources.map((source) => ({
        researchSessionId: session.id,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        sourceUrl: source.url,
        publishedAt: source.publishedAt,
        excerpt: source.excerpt,
        relevance: source.query,
      })),
    });
    const savedSources = await database.researchSource.findMany({
      where: { researchSessionId: session.id },
      orderBy: { retrievedAt: "asc" },
    });
    const sourcesForSynthesis = retrieval.sources.map((source) => {
      const saved = savedSources.find(
        (candidate) => candidate.canonicalUrl === source.canonicalUrl,
      );
      if (!saved) {
        throw new ResearchSessionError(
          "A retrieved source could not be persisted.",
          "persistence",
        );
      }
      return { ...source, id: saved.id };
    });

    await database.executionJob.update({
      where: { id: session.executionId },
      data: { progress: 10 },
    });
    let configuration: Awaited<ReturnType<typeof getAIConfigurationForStage>>;
    try {
      configuration = await (options.getAIConfiguration ?? getAIConfigurationForStage)(
        "research",
      );
    } catch (error) {
      throw new ResearchSessionError(
        error instanceof Error
          ? error.message
          : "Research AI configuration is unavailable.",
        "configuration",
      );
    }
    const synthesis =
      options.synthesisProvider ?? createAISynthesisProvider(configuration);
    const rawReport = await synthesizeResearchReport(
      schedule,
      sourcesForSynthesis,
      synthesis,
    );
    const report = validateResearchCitations(rawReport, sourcesForSynthesis.length);
    const reportView = researchReportForStorage(
      report,
      sourcesForSynthesis.map((source, index) => ({
        ref: `S${index + 1}`,
        id: source.id,
      })),
      {
        queries: retrieval.queries,
        warnings: retrieval.warnings,
        provider: configuration.providerName,
        model: configuration.modelName,
        generatedAt: new Date(),
      },
    );

    await database.$transaction(async (transaction) => {
      await transaction.researchSession.update({
        where: { id: session.id },
        data: {
          status: "Complete",
          reportJson: JSON.stringify(reportView),
          finishedAt: new Date(),
        },
      });
      await transaction.executionJob.update({
        where: { id: session.executionId },
        data: {
          status: "ResearchComplete",
          stage: "Research",
          progress: 20,
          errorCategory: null,
          errorMessage: null,
        },
      });
      await transaction.executionLog.create({
        data: {
          executionId: session.executionId,
          stage: "Research",
          event: "research_completed",
          message: `Research completed with ${savedSources.length} sources.`,
          metadataJson: JSON.stringify({
            sourceCount: savedSources.length,
            warningCount: retrieval.warnings.length,
          }),
        },
      });
    });
  } catch (error) {
    const failure =
      error instanceof ResearchSessionError
        ? error
        : error instanceof AIProviderError
          ? new ResearchSessionError(
              error.message,
              "synthesis",
              error.status,
            )
          : new ResearchSessionError(
              error instanceof Error
                ? error.message
                : "Research failed unexpectedly.",
              "retrieval",
            );
    try {
      const failedSession = await database.researchSession.findUnique({
        where: { id: sessionId },
        select: { executionId: true },
      });
      if (failedSession) {
        await database.$transaction(async (transaction) => {
          await transaction.researchSession.update({
            where: { id: sessionId },
            data: { status: "Failed", finishedAt: new Date() },
          });
          await transaction.executionJob.update({
            where: { id: failedSession.executionId },
            data: {
              status: "ResearchFailed",
              stage: "Research",
              errorCategory: failure.category,
              errorMessage: failure.message.slice(0, 1000),
            },
          });
          await transaction.executionLog.create({
            data: {
              executionId: failedSession.executionId,
              stage: "Research",
              level: "error",
              event: "research_failed",
              message: failure.message.slice(0, 1000),
              metadataJson: JSON.stringify({
                category: failure.category,
                status: failure.status ?? null,
              }),
            },
          });
        });
      }
    } catch (persistenceError) {
      console.error("Could not persist failed research status", persistenceError);
    }
    throw failure;
  }
}

export async function getResearchHistory(scheduleId: string) {
  const schedule = await prisma.nicheSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      niche: true,
      targetCountry: true,
      targetAudience: true,
      language: true,
      executionDate: true,
      executions: {
        where: { idempotencyKey: { startsWith: "research:" } },
        select: {
          researchSessions: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              sources: {
                orderBy: { retrievedAt: "asc" },
                select: {
                  id: true,
                  title: true,
                  sourceUrl: true,
                  canonicalUrl: true,
                  publishedAt: true,
                  retrievedAt: true,
                  excerpt: true,
                  relevance: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!schedule) {
    throw new ResearchSessionError("The requested schedule was not found.", "schedule", 404);
  }

  const sessions = schedule.executions
    .flatMap((execution) => execution.researchSessions)
    .sort((left, right) => right.createdAt.valueOf() - left.createdAt.valueOf())
    .slice(0, 10)
    .map((session) => ({
      id: session.id,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      startedAt: session.startedAt?.toISOString() ?? null,
      finishedAt: session.finishedAt?.toISOString() ?? null,
      report: session.reportJson ? JSON.parse(session.reportJson) : null,
      sources: session.sources.map((source) => ({
        ...source,
        retrievedAt: source.retrievedAt.toISOString(),
      })),
    }));

  return {
    schedule: {
      ...schedule,
      executionDate: schedule.executionDate.toISOString(),
    },
    sessions,
  };
}
