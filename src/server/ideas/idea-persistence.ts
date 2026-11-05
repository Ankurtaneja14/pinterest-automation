import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAIConfigurationForStage } from "@/server/ai/configuration";
import { AIProviderError } from "@/server/ai/openai-compatible";
import {
  createAIIdeaGenerationProvider,
  generateDistinctIdeas,
  type IdeaGenerationProvider,
} from "./idea-generation";
import { persistedIdeaSchema } from "./idea-schema";

type Database = Pick<
  PrismaClient,
  | "$transaction"
  | "nicheSchedule"
  | "executionJob"
  | "researchSession"
  | "researchSource"
  | "contentIdea"
>;

const STALE_IDEA_GENERATION_MS = 8 * 60 * 1000;

export class IdeaGenerationError extends Error {
  constructor(
    message: string,
    readonly category: "schedule" | "research" | "configuration" | "generation" | "persistence",
    readonly status?: number,
  ) {
    super(message);
    this.name = "IdeaGenerationError";
  }
}

export async function enqueueIdeaGeneration(
  scheduleId: string,
  database: Database = prisma,
): Promise<{
  researchSessionId: string;
  alreadyRunning: boolean;
  alreadyComplete: boolean;
}> {
  const schedule = await database.nicheSchedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, scheduleKey: true },
  });
  if (!schedule) {
    throw new IdeaGenerationError("The requested schedule was not found.", "schedule", 404);
  }

  return database.$transaction(async (transaction) => {
    const execution = await transaction.executionJob.findUnique({
      where: { idempotencyKey: `research:${schedule.scheduleKey}` },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        researchSessions: {
          where: { status: "Complete" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    const researchSession = execution?.researchSessions[0];
    if (!execution || !researchSession) {
      throw new IdeaGenerationError(
        "Complete research before generating ideas.",
        "research",
        409,
      );
    }

    if (execution.status === "IdeasGenerating") {
      if (Date.now() - execution.updatedAt.valueOf() < STALE_IDEA_GENERATION_MS) {
        return {
          researchSessionId: researchSession.id,
          alreadyRunning: true,
          alreadyComplete: false,
        };
      }
      const recovered = await transaction.executionJob.updateMany({
        where: { id: execution.id, status: "IdeasGenerating" },
        data: {
          status: "IdeasFailed",
          errorCategory: "generation",
          errorMessage:
            "Idea generation stopped updating for more than eight minutes. It can be safely retried.",
        },
      });
      if (recovered.count === 0) {
        return {
          researchSessionId: researchSession.id,
          alreadyRunning: true,
          alreadyComplete: false,
        };
      }
      await transaction.executionLog.create({
        data: {
          executionId: execution.id,
          stage: "IdeaGeneration",
          level: "error",
          event: "idea_generation_stale_recovered",
          message: "A stale idea-generation run was marked failed so it can be retried.",
        },
      });
    }

    const existingCount = await transaction.contentIdea.count({
      where: {
        executionId: execution.id,
        researchSessionId: researchSession.id,
      },
    });
    const savedSchedule = await transaction.nicheSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: { researchIdeasCount: true },
    });
    if (existingCount >= savedSchedule.researchIdeasCount) {
      return {
        researchSessionId: researchSession.id,
        alreadyRunning: false,
        alreadyComplete: true,
      };
    }

    const claimed = await transaction.executionJob.updateMany({
      where: { id: execution.id, status: { not: "IdeasGenerating" } },
      data: {
        status: "IdeasGenerating",
        stage: "IdeaGeneration",
        progress: 20,
        errorCategory: null,
        errorMessage: null,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      return {
        researchSessionId: researchSession.id,
        alreadyRunning: true,
        alreadyComplete: false,
      };
    }

    return {
      researchSessionId: researchSession.id,
      alreadyRunning: false,
      alreadyComplete: false,
    };
  });
}

export async function processIdeaGeneration(
  researchSessionId: string,
  options: {
    database?: Database;
    provider?: IdeaGenerationProvider;
    getAIConfiguration?: typeof getAIConfigurationForStage;
  } = {},
): Promise<void> {
  const database = options.database ?? prisma;
  try {
    const session = await database.researchSession.findUnique({
      where: { id: researchSessionId },
      include: {
        execution: { include: { schedule: true } },
        sources: { orderBy: [{ retrievedAt: "asc" }, { id: "asc" }] },
      },
    });
    if (!session || session.status !== "Complete" || !session.reportJson) {
      throw new IdeaGenerationError(
        "Complete research is required before generating ideas.",
        "research",
      );
    }
    let report: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(session.reportJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Report must be a JSON object.");
      }
      report = parsed as Record<string, unknown>;
    } catch {
      throw new IdeaGenerationError(
        "The saved research report could not be read.",
        "research",
      );
    }

    const existing = await database.contentIdea.findMany({
      where: {
        executionId: session.executionId,
        researchSessionId: session.id,
      },
      select: { title: true, ideaKey: true },
      orderBy: { createdAt: "asc" },
    });
    let configuration: Awaited<ReturnType<typeof getAIConfigurationForStage>>;
    try {
      configuration = await (options.getAIConfiguration ?? getAIConfigurationForStage)(
        "idea_generation",
      );
    } catch (error) {
      throw new IdeaGenerationError(
        error instanceof Error
          ? error.message
          : "Idea-generation AI configuration is unavailable.",
        "configuration",
      );
    }
    const provider =
      options.provider ?? createAIIdeaGenerationProvider(configuration);
    const ideas = await generateDistinctIdeas({
      schedule: session.execution.schedule,
      report,
      sources: session.sources.map((source) => ({
        id: source.id,
        title: source.title,
        sourceUrl: source.sourceUrl,
        excerpt: source.excerpt,
      })),
      existingIdeas: existing,
      provider,
      onProgress: async (generatedCount) => {
        const progress = Math.min(
          39,
          20 +
            Math.floor(
              ((existing.length + generatedCount) /
                session.execution.schedule.researchIdeasCount) *
                19,
            ),
        );
        await database.executionJob.update({
          where: { id: session.executionId },
          data: { progress },
        });
      },
    });

    await database.$transaction(async (transaction) => {
      await transaction.contentIdea.createMany({
        data: ideas.map(({ draft, sourceIds, ideaKey }) => ({
          executionId: session.executionId,
          researchSessionId: session.id,
          ideaKey,
          title: draft.title,
          coreConcept: draft.coreConcept,
          explanation: draft.explanation,
          audienceSegment: draft.audienceSegment,
          audienceNeed: draft.audienceNeed,
          searchIntent: draft.searchIntent,
          keywordsJson: JSON.stringify(draft.keywords),
          rationale: draft.rationale,
          sourceReferencesJson: JSON.stringify(sourceIds),
          visualDirection: draft.visualDirection,
          contentFormat: draft.contentFormat,
          trendClassification: draft.trendClassification,
          destinationRelevance: draft.destinationRelevance,
          validationStatus: "Valid",
        })),
      });
      await transaction.executionJob.update({
        where: { id: session.executionId },
        data: {
          status: "IdeasGenerated",
          stage: "IdeaGeneration",
          progress: 40,
          errorCategory: null,
          errorMessage: null,
        },
      });
      await transaction.executionLog.create({
        data: {
          executionId: session.executionId,
          stage: "IdeaGeneration",
          event: "ideas_generated",
          message: `Generated ${ideas.length} distinct validated content ideas.`,
          metadataJson: JSON.stringify({
            researchSessionId: session.id,
            ideaCount: ideas.length,
          }),
        },
      });
    });
  } catch (error) {
    const failure =
      error instanceof IdeaGenerationError
        ? error
        : error instanceof AIProviderError
          ? new IdeaGenerationError(error.message, "generation", error.status)
          : new IdeaGenerationError(
              error instanceof Error ? error.message : "Idea generation failed.",
              "generation",
            );
    try {
      const session = await database.researchSession.findUnique({
        where: { id: researchSessionId },
        select: { executionId: true },
      });
      if (session) {
        await database.$transaction(async (transaction) => {
          await transaction.executionJob.update({
            where: { id: session.executionId },
            data: {
              status: "IdeasFailed",
              stage: "IdeaGeneration",
              errorCategory: failure.category,
              errorMessage: failure.message.slice(0, 1000),
            },
          });
          await transaction.executionLog.create({
            data: {
              executionId: session.executionId,
              stage: "IdeaGeneration",
              level: "error",
              event: "idea_generation_failed",
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
      console.error("Could not persist idea generation failure", persistenceError);
    }
    throw failure;
  }
}

export async function getIdeaWorkspace(scheduleId: string) {
  const schedule = await prisma.nicheSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      niche: true,
      targetCountry: true,
      targetAudience: true,
      language: true,
      researchIdeasCount: true,
      pinsToGenerate: true,
      destinationUrl: true,
      executions: {
        where: { idempotencyKey: { startsWith: "research:" } },
        take: 1,
        select: {
          id: true,
          status: true,
          errorCategory: true,
          errorMessage: true,
          researchSessions: {
            where: { status: "Complete" },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              ideas: {
                orderBy: { createdAt: "asc" },
                include: { score: true, selection: true, contentPackage: true },
              },
              sources: {
                orderBy: [{ retrievedAt: "asc" }, { id: "asc" }],
                select: { id: true, title: true, sourceUrl: true },
              },
            },
          },
        },
      },
    },
  });
  if (!schedule) {
    throw new IdeaGenerationError("The requested schedule was not found.", "schedule", 404);
  }
  const execution = schedule.executions[0];
  const session = execution?.researchSessions[0];
  if (!execution || !session) {
    throw new IdeaGenerationError(
      "Complete research before opening the idea workspace.",
      "research",
      409,
    );
  }

  const ideas = session.ideas.map((idea) => {
    const parsed = persistedIdeaSchema.parse({
      id: idea.id,
      title: idea.title,
      coreConcept: idea.coreConcept,
      explanation: idea.explanation,
      audienceSegment: idea.audienceSegment,
      audienceNeed: idea.audienceNeed,
      searchIntent: idea.searchIntent,
      keywords: JSON.parse(idea.keywordsJson),
      rationale: idea.rationale,
      visualDirection: idea.visualDirection,
      contentFormat: idea.contentFormat,
      trendClassification: idea.trendClassification,
      destinationRelevance: idea.destinationRelevance,
      sourceIds: JSON.parse(idea.sourceReferencesJson),
      validationStatus: idea.validationStatus,
      createdAt: idea.createdAt.toISOString(),
      score: idea.score
        ? {
            trendRelevance: idea.score.trendRelevance,
            audienceResonance: idea.score.audienceResonance,
            searchPotential: idea.score.searchPotential,
            clickPotential: idea.score.clickPotential,
            visualAppeal: idea.score.visualAppeal,
            originality: idea.score.originality,
            evergreenValue: idea.score.evergreenValue,
            finalScore: idea.score.finalScore,
            reasoning: idea.score.reasoningJson,
            strengths: JSON.parse(idea.score.strengthsJson),
            weaknesses: JSON.parse(idea.score.weaknessesJson),
            improvementSuggestions: JSON.parse(
              idea.score.improvementSuggestionsJson,
            ),
          }
        : null,
      selection: idea.selection
        ? {
            rank: idea.selection.rank,
            selected: idea.selection.selected,
            reason: idea.selection.reason,
          }
        : null,
      contentPackage: idea.contentPackage
        ? {
            contentId: idea.contentPackage.contentId,
            pinterestTitle: idea.contentPackage.pinterestTitle,
            description: idea.contentPackage.description,
            hashtags: JSON.parse(idea.contentPackage.hashtagsJson),
            keywords: JSON.parse(idea.contentPackage.keywordsJson),
            imagePrompt: idea.contentPackage.imagePrompt,
            destinationUrl: idea.contentPackage.destinationUrl,
            generationStatus: idea.contentPackage.generationStatus,
          }
        : null,
    });
    return parsed;
  });

  return {
    schedule: {
      id: schedule.id,
      niche: schedule.niche,
      targetCountry: schedule.targetCountry,
      targetAudience: schedule.targetAudience,
      language: schedule.language,
      researchIdeasCount: schedule.researchIdeasCount,
      pinsToGenerate: schedule.pinsToGenerate,
      destinationUrl: schedule.destinationUrl,
    },
    researchSessionId: session.id,
    generationStatus: execution.status,
    errorCategory: execution.errorCategory,
    errorMessage: execution.errorMessage,
    sources: session.sources,
    ideas,
  };
}
