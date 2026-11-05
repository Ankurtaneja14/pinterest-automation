import { z } from "zod";

const ideaDraftSchema = z.object({
  title: z.string().trim().min(8).max(180),
  coreConcept: z.string().trim().min(12).max(300),
  explanation: z.string().trim().min(20).max(700),
  audienceSegment: z.string().trim().min(3).max(160),
  audienceNeed: z.string().trim().min(8).max(240),
  searchIntent: z.enum(["informational", "inspirational", "commercial", "seasonal"]),
  keywords: z.array(z.string().trim().min(2).max(60)).min(3).max(10),
  rationale: z.string().trim().min(12).max(500),
  visualDirection: z.string().trim().min(15).max(500),
  contentFormat: z.string().trim().min(3).max(80),
  trendClassification: z.enum(["emerging", "seasonal", "evergreen"]),
  destinationRelevance: z.string().trim().min(12).max(300),
  sourceRefs: z.array(z.string().regex(/^S\d{1,3}$/)).min(1).max(8),
});

export type IdeaDraft = z.infer<typeof ideaDraftSchema>;

export function ideaBatchSchema(count: number) {
  return z.object({
    ideas: z.array(ideaDraftSchema).length(count),
  });
}

export const persistedIdeaSchema = z.object({
  id: z.string(),
  title: z.string(),
  coreConcept: z.string(),
  explanation: z.string(),
  audienceSegment: z.string(),
  audienceNeed: z.string(),
  searchIntent: z.string(),
  keywords: z.array(z.string()),
  rationale: z.string(),
  visualDirection: z.string(),
  contentFormat: z.string(),
  trendClassification: z.string(),
  destinationRelevance: z.string(),
  sourceIds: z.array(z.string()),
  validationStatus: z.string(),
  createdAt: z.string(),
  score: z.object({
    trendRelevance: z.number().int().min(1).max(10),
    audienceResonance: z.number().int().min(1).max(10),
    searchPotential: z.number().int().min(1).max(10),
    clickPotential: z.number().int().min(1).max(10),
    visualAppeal: z.number().int().min(1).max(10),
    originality: z.number().int().min(1).max(10),
    evergreenValue: z.number().int().min(1).max(10),
    finalScore: z.number().min(10).max(100),
    reasoning: z.string(),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    improvementSuggestions: z.array(z.string()),
  }).nullable(),
  selection: z.object({
    rank: z.number().int().positive(),
    selected: z.boolean(),
    reason: z.string().nullable(),
  }).nullable(),
  contentPackage: z.object({
    contentId: z.string(),
    pinterestTitle: z.string(),
    description: z.string(),
    hashtags: z.array(z.string()),
    keywords: z.array(z.string()),
    imagePrompt: z.string(),
    destinationUrl: z.string().url(),
    generationStatus: z.string(),
  }).nullable(),
});

export type PersistedIdea = z.infer<typeof persistedIdeaSchema>;
