import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAIConfigurationForStage } from "@/server/ai/configuration";
import { AIProviderError } from "@/server/ai/openai-compatible";
import {
  createAIIdeaScoringProvider,
  rankScoredIdeas,
  scoreIdeasInBatches,
  selectDiverseIdeas,
  type IdeaScoreEntry,
} from "./idea-scoring";

type Database = Pick<
  PrismaClient,
  | "$transaction"
  | "executionJob"
  | "executionLog"
  | "researchSession"
  | "contentIdea"
  | "ideaScore"
  | "selectedIdea"
>;

const STALE_SCORING_MS = 8 * 60 * 1000;

export class IdeaScoringError extends Error {
  constructor(
    message: string,
    readonly category: "ideas" | "configuration" | "scoring" | "persistence",
    readonly status?: number,
  ) {
    super(message);
    this.name = "IdeaScoringError";
  }
}

export async function enqueueIdeaScoring(
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
        execution: { select: { id: true, status: true, updatedAt: true } },
        ideas: { select: { id: true, validationStatus: true } },
      },
    });
    if (!session || session.status !== "Complete") {
      throw new IdeaScoringError(
        "Complete research is required before scoring ideas.",
        "ideas",
        409,
      );
    }
    if (session.ideas.length === 0) {
      throw new IdeaScoringError(
        "Generate content ideas before scoring them.",
        "ideas",
        409,
      );
    }
    if (session.execution.status === "Scored") {
      const scoreCount = await transaction.ideaScore.count({
        where: { ideaId: { in: session.ideas.map((idea) => idea.id) } },
      });
      if (scoreCount === session.ideas.length) {
        return { alreadyRunning: false, alreadyComplete: true };
      }
    }

    if (session.execution.status === "Scoring") {
      if (Date.now() - session.execution.updatedAt.valueOf() < STALE_SCORING_MS) {
        return { alreadyRunning: true, alreadyComplete: false };
      }
      const recovered = await transaction.executionJob.updateMany({
        where: { id: session.executionId, status: "Scoring" },
        data: {
          status: "ScoringFailed",
          errorCategory: "scoring",
          errorMessage:
            "Idea scoring stopped updating for more than eight minutes. It can be safely retried.",
        },
      });
      if (recovered.count === 0) {
        return { alreadyRunning: true, alreadyComplete: false };
      }
      await transaction.executionLog.create({
        data: {
          executionId: session.executionId,
          stage: "IdeaScoring",
          level: "error",
          event: "idea_scoring_stale_recovered",
          message: "A stale scoring run was marked failed so it can be retried.",
        },
      });
    }

    const claimed = await transaction.executionJob.updateMany({
      where: { id: session.executionId, status: { not: "Scoring" } },
      data: {
        status: "Scoring",
        stage: "IdeaScoring",
        progress: 40,
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

export async function processIdeaScoring(
  researchSessionId: string,
  options: {
    database?: Database;
    scoreProvider?: {
      score: (
        systemPrompt: string,
        userPrompt: string,
        ideaIds: string[],
      ) => Promise<{ scores: IdeaScoreEntry[] }>;
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
        ideas: { where: { validationStatus: "Valid" }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!session || session.status !== "Complete" || session.ideas.length === 0) {
      throw new IdeaScoringError(
        "Complete research with valid ideas is required before scoring.",
        "ideas",
      );
    }
    let configuration: Awaited<ReturnType<typeof getAIConfigurationForStage>>;
    try {
      configuration = await (options.getAIConfiguration ?? getAIConfigurationForStage)(
        "idea_evaluation",
      );
    } catch (error) {
      throw new IdeaScoringError(
        error instanceof Error
          ? error.message
          : "Idea-evaluation AI configuration is unavailable.",
        "configuration",
      );
    }
    const provider =
      options.scoreProvider ?? createAIIdeaScoringProvider(configuration);
    const scoredIdeas = session.ideas.map((idea) => ({
      id: idea.id,
      title: idea.title,
      coreConcept: idea.coreConcept,
      explanation: idea.explanation,
      audienceSegment: idea.audienceSegment,
      audienceNeed: idea.audienceNeed,
      searchIntent: idea.searchIntent,
      keywords: JSON.parse(idea.keywordsJson) as string[],
      rationale: idea.rationale,
      visualDirection: idea.visualDirection,
      contentFormat: idea.contentFormat,
      trendClassification: idea.trendClassification,
      destinationRelevance: idea.destinationRelevance,
      sourceIds: JSON.parse(idea.sourceReferencesJson) as string[],
    }));
    const scores = await scoreIdeasInBatches(scoredIdeas, provider);
    const ranked = rankScoredIdeas(scoredIdeas, scores);
    const selected = selectDiverseIdeas(
      ranked,
      session.execution.schedule.pinsToGenerate,
    );
    const selectionReasonById = new Map(
      selected.map((idea) => [idea.idea.id, idea.selectionReason]),
    );
    const selectedFirst = [
      ...selected,
      ...ranked.filter((item) => !selectionReasonById.has(item.idea.id)),
    ];
    const rankById = new Map(selectedFirst.map((item, index) => [item.idea.id, index + 1]));
    const finalScoreById = new Map(
      ranked.map((item) => [item.idea.id, item.finalScore]),
    );
    const scoreById = new Map(scores.map((score) => [score.ideaId, score]));

    await database.$transaction(async (transaction) => {
      for (const idea of scoredIdeas) {
        const score = scoreById.get(idea.id);
        if (!score) {
          throw new IdeaScoringError(
            "A generated score could not be matched to its idea.",
            "persistence",
          );
        }
        const finalScore = finalScoreById.get(idea.id);
        if (finalScore === undefined) {
          throw new IdeaScoringError(
            "A weighted score could not be calculated for an idea.",
            "persistence",
          );
        }
        await transaction.ideaScore.upsert({
          where: { ideaId: idea.id },
          create: {
            ideaId: idea.id,
            trendRelevance: score.trendRelevance,
            audienceResonance: score.audienceResonance,
            searchPotential: score.searchPotential,
            clickPotential: score.clickPotential,
            visualAppeal: score.visualAppeal,
            originality: score.originality,
            evergreenValue: score.evergreenValue,
            finalScore,
            reasoningJson: JSON.stringify(score.reasoning),
            strengthsJson: JSON.stringify(score.strengths),
            weaknessesJson: JSON.stringify(score.weaknesses),
            improvementSuggestionsJson: JSON.stringify(score.improvementSuggestions),
          },
          update: {
            trendRelevance: score.trendRelevance,
            audienceResonance: score.audienceResonance,
            searchPotential: score.searchPotential,
            clickPotential: score.clickPotential,
            visualAppeal: score.visualAppeal,
            originality: score.originality,
            evergreenValue: score.evergreenValue,
            finalScore,
            reasoningJson: JSON.stringify(score.reasoning),
            strengthsJson: JSON.stringify(score.strengths),
            weaknessesJson: JSON.stringify(score.weaknesses),
            improvementSuggestionsJson: JSON.stringify(score.improvementSuggestions),
          },
        });
      }

      await transaction.selectedIdea.deleteMany({
        where: { executionId: session.executionId },
      });
      await transaction.selectedIdea.createMany({
        data: selectedFirst.map((item) => {
          const selectionReason = selectionReasonById.get(item.idea.id);
          return {
            executionId: session.executionId,
            ideaId: item.idea.id,
            rank: rankById.get(item.idea.id)!,
            selected: selectionReason !== undefined,
            reason: selectionReason ??
              "Not selected: ranked below the requested diverse subset.",
          };
        }),
      });
      await transaction.executionJob.update({
        where: { id: session.executionId },
        data: {
          status: "Scored",
          stage: "IdeaScoring",
          progress: 55,
          errorCategory: null,
          errorMessage: null,
        },
      });
      await transaction.executionLog.create({
        data: {
          executionId: session.executionId,
          stage: "IdeaScoring",
          event: "ideas_scored",
          message: `Scored ${scoredIdeas.length} ideas and selected ${selected.length} for content generation.`,
          metadataJson: JSON.stringify({
            ideaCount: scoredIdeas.length,
            selectedCount: selected.length,
            requestedPins: session.execution.schedule.pinsToGenerate,
            scoreWeights: {
              trendRelevance: 0.15,
              audienceResonance: 0.2,
              searchPotential: 0.2,
              clickPotential: 0.15,
              visualAppeal: 0.15,
              originality: 0.1,
              evergreenValue: 0.05,
            },
          }),
        },
      });
    });
  } catch (error) {
    const failure =
      error instanceof IdeaScoringError
        ? error
        : error instanceof AIProviderError
          ? new IdeaScoringError(error.message, "scoring", error.status)
          : new IdeaScoringError(
              error instanceof Error ? error.message : "Idea scoring failed.",
              "scoring",
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
              status: "ScoringFailed",
              stage: "IdeaScoring",
              errorCategory: failure.category,
              errorMessage: failure.message.slice(0, 1000),
            },
          });
          await transaction.executionLog.create({
            data: {
              executionId: session.executionId,
              stage: "IdeaScoring",
              level: "error",
              event: "idea_scoring_failed",
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
      console.error("Could not persist idea scoring failure", persistenceError);
    }
    throw failure;
  }
}
