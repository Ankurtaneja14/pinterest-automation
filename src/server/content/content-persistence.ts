import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAIConfigurationForStage } from "@/server/ai/configuration";
import { AIProviderError } from "@/server/ai/openai-compatible";
import {
  createAIContentGenerationProvider,
  generateContentPackages,
  type ContentDraft,
  validateContentPackages,
} from "./content-generation";

type Database = Pick<
  PrismaClient,
  | "$transaction"
  | "executionJob"
  | "executionLog"
  | "researchSession"
  | "contentPackage"
>
  & Pick<PrismaClient, "selectedIdea">;

const STALE_CONTENT_GENERATION_MS = 8 * 60 * 1000;

export class ContentGenerationError extends Error {
  constructor(
    message: string,
    readonly category: "research" | "selected_ideas" | "configuration" | "generation" | "persistence",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ContentGenerationError";
  }
}

export async function enqueueContentGeneration(
  researchSessionId: string,
  database: Database = prisma,
): Promise<{ alreadyRunning: boolean; alreadyComplete: boolean }> {
  return database.$transaction(async (transaction) => {
    const session = await transaction.researchSession.findUnique({
      where: { id: researchSessionId },
      select: {
        id: true,
        status: true,
        executionId: true,
        execution: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
            schedule: { select: { pinsToGenerate: true } },
          },
        },
        ideas: {
          select: {
            id: true,
            validationStatus: true,
            score: { select: { id: true } },
            selection: { select: { selected: true } },
            contentPackage: { select: { generationStatus: true } },
          },
        },
      },
    });
    if (!session || session.status !== "Complete") {
      throw new ContentGenerationError(
        "Complete research is required before generating pin content.",
        "research",
        409,
      );
    }

    const selected = session.ideas.filter(
      (idea) => idea.validationStatus === "Valid" && idea.selection?.selected,
    );
    if (selected.length === 0 || selected.some((idea) => !idea.score)) {
      throw new ContentGenerationError(
        "Score ideas and select pins before generating pin content.",
        "selected_ideas",
        409,
      );
    }
    if (selected.length > session.execution.schedule.pinsToGenerate) {
      throw new ContentGenerationError(
        "The selected pin count exceeds the schedule limit. Re-score the ideas before generating content.",
        "selected_ideas",
        409,
      );
    }

    if (
      session.execution.status === "ContentGenerated" &&
      selected.every((idea) => idea.contentPackage?.generationStatus === "Complete")
    ) {
      return { alreadyRunning: false, alreadyComplete: true };
    }

    if (session.execution.status === "ContentGenerating") {
      if (
        Date.now() - session.execution.updatedAt.valueOf() <
        STALE_CONTENT_GENERATION_MS
      ) {
        return { alreadyRunning: true, alreadyComplete: false };
      }
      const recovered = await transaction.executionJob.updateMany({
        where: { id: session.executionId, status: "ContentGenerating" },
        data: {
          status: "ContentFailed",
          errorCategory: "generation",
          errorMessage:
            "Content generation stopped updating for more than eight minutes. It can be safely retried.",
        },
      });
      if (recovered.count === 0) {
        return { alreadyRunning: true, alreadyComplete: false };
      }
      await transaction.executionLog.create({
        data: {
          executionId: session.executionId,
          stage: "ContentGeneration",
          level: "error",
          event: "content_generation_stale_recovered",
          message: "A stale content-generation run was marked failed so it can be retried.",
        },
      });
    }

    const claimed = await transaction.executionJob.updateMany({
      where: { id: session.executionId, status: { not: "ContentGenerating" } },
      data: {
        status: "ContentGenerating",
        stage: "ContentGeneration",
        progress: 60,
        errorCategory: null,
        errorMessage: null,
        attemptCount: { increment: 1 },
      },
    });
    return {
      alreadyRunning: claimed.count === 0,
      alreadyComplete: false,
    };
  });
}

export async function processContentGeneration(
  researchSessionId: string,
  options: {
    database?: Database;
    provider?: {
      generate: (
        systemPrompt: string,
        userPrompt: string,
        ideaIds: string[],
      ) => Promise<{ packages: ContentDraft[] }>;
    };
    getAIConfiguration?: typeof getAIConfigurationForStage;
  } = {},
): Promise<void> {
  const database = options.database ?? prisma;
  try {
    const session = await database.researchSession.findUnique({
      where: { id: researchSessionId },
      include: {
        execution: { include: { schedule: true } },
        ideas: {
          where: { validationStatus: "Valid" },
          include: {
            score: true,
            selection: true,
            contentPackage: true,
          },
        },
      },
    });
    if (!session || session.status !== "Complete") {
      throw new ContentGenerationError(
        "Complete research is required before generating pin content.",
        "research",
      );
    }

    const selected = session.ideas
      .filter((idea) => idea.selection?.selected)
      .sort((left, right) => left.selection!.rank - right.selection!.rank)
      .slice(0, session.execution.schedule.pinsToGenerate);
    if (selected.length === 0 || selected.some((idea) => !idea.score)) {
      throw new ContentGenerationError(
        "Score ideas and select pins before generating pin content.",
        "selected_ideas",
      );
    }

    const completeIdeas = selected.filter(
      (idea) => idea.contentPackage?.generationStatus === "Complete",
    );
    const pendingIdeas = selected.filter(
      (idea) => idea.contentPackage?.generationStatus !== "Complete",
    );
    if (pendingIdeas.length === 0) {
      await database.executionJob.update({
        where: { id: session.executionId },
        data: {
          status: "ContentGenerated",
          stage: "ContentGeneration",
          progress: 75,
          errorCategory: null,
          errorMessage: null,
        },
      });
      return;
    }

    let configuration: Awaited<ReturnType<typeof getAIConfigurationForStage>>;
    try {
      configuration = await (options.getAIConfiguration ?? getAIConfigurationForStage)(
        "content_generation",
      );
    } catch (error) {
      throw new ContentGenerationError(
        error instanceof Error
          ? error.message
          : "Content-generation AI configuration is unavailable.",
        "configuration",
      );
    }
    const provider = options.provider ?? createAIContentGenerationProvider(configuration);
    const ideaInputs = pendingIdeas.map((idea) => {
      if (!idea.score) {
        throw new ContentGenerationError(
          "A selected idea is missing its quality score.",
          "selected_ideas",
        );
      }
      return {
        id: idea.id,
        title: idea.title,
        coreConcept: idea.coreConcept,
        explanation: idea.explanation,
        audienceSegment: idea.audienceSegment,
        audienceNeed: idea.audienceNeed,
        keywords: JSON.parse(idea.keywordsJson) as string[],
        visualDirection: idea.visualDirection,
        contentFormat: idea.contentFormat,
        destinationRelevance: idea.destinationRelevance,
        finalScore: idea.score.finalScore,
      };
    });
    let savedCount = completeIdeas.length;
    const packages = await generateContentPackages({
      niche: session.execution.schedule.niche,
      targetCountry: session.execution.schedule.targetCountry,
      targetAudience: session.execution.schedule.targetAudience,
      language: session.execution.schedule.language,
      destinationUrl: session.execution.schedule.destinationUrl,
      ideas: ideaInputs,
      provider: {
        generate: async (systemPrompt, userPrompt, ideaIds) => {
          const response = await provider.generate(systemPrompt, userPrompt, ideaIds);
          const validatedPackages = validateContentPackages(
            ideaIds,
            response.packages,
          );
          const ideaById = new Map(
            ideaInputs.map((idea) => [idea.id, idea]),
          );
          await database.$transaction(async (transaction) => {
            for (const content of validatedPackages) {
              const idea = ideaById.get(content.ideaId);
              if (!idea) {
                throw new ContentGenerationError(
                  "A generated package could not be matched to a selected idea.",
                  "persistence",
                );
              }
              await transaction.contentPackage.upsert({
                where: { ideaId: idea.id },
                create: {
                  contentId: randomUUID(),
                  ideaId: idea.id,
                  pinterestTitle: content.pinterestTitle,
                  description: content.description,
                  hashtagsJson: JSON.stringify(content.hashtags),
                  keywordsJson: JSON.stringify(content.keywords),
                  imagePrompt: content.imagePrompt,
                  destinationUrl: session.execution.schedule.destinationUrl,
                  generationStatus: "Complete",
                },
                update: {
                  pinterestTitle: content.pinterestTitle,
                  description: content.description,
                  hashtagsJson: JSON.stringify(content.hashtags),
                  keywordsJson: JSON.stringify(content.keywords),
                  imagePrompt: content.imagePrompt,
                  destinationUrl: session.execution.schedule.destinationUrl,
                  generationStatus: "Complete",
                  generatedAt: new Date(),
                },
              });
            }
          });
          savedCount += validatedPackages.length;
          await database.executionJob.update({
            where: { id: session.executionId },
            data: {
              progress: Math.min(
                74,
                60 + Math.floor((savedCount / selected.length) * 14),
              ),
            },
          });
          return { packages: validatedPackages };
        },
      },
    });

    if (packages.length !== pendingIdeas.length || savedCount !== selected.length) {
      throw new ContentGenerationError(
        "Not every selected idea has a complete content package.",
        "persistence",
      );
    }

    await database.$transaction(async (transaction) => {
      await transaction.executionJob.update({
        where: { id: session.executionId },
        data: {
          status: "ContentGenerated",
          stage: "ContentGeneration",
          progress: 75,
          errorCategory: null,
          errorMessage: null,
        },
      });
      await transaction.executionLog.create({
        data: {
          executionId: session.executionId,
          stage: "ContentGeneration",
          event: "content_packages_generated",
          message: `Generated ${packages.length} content packages; ${completeIdeas.length} previously completed packages were preserved.`,
          metadataJson: JSON.stringify({
            selectedIdeaCount: selected.length,
            generatedPackageCount: packages.length,
            preservedPackageCount: completeIdeas.length,
          }),
        },
      });
    });
  } catch (error) {
    const failure =
      error instanceof ContentGenerationError
        ? error
        : error instanceof AIProviderError
          ? new ContentGenerationError(error.message, "generation", error.status)
          : new ContentGenerationError(
              error instanceof Error ? error.message : "Content generation failed.",
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
              status: "ContentFailed",
              stage: "ContentGeneration",
              errorCategory: failure.category,
              errorMessage: failure.message.slice(0, 1000),
            },
          });
          await transaction.executionLog.create({
            data: {
              executionId: session.executionId,
              stage: "ContentGeneration",
              level: "error",
              event: "content_generation_failed",
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
      console.error("Could not persist content-generation failure", persistenceError);
    }
    throw failure;
  }
}
