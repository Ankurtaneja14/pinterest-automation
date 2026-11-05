import { z } from "zod";

const citedClaimSchema = z.object({
  text: z.string().trim().min(12).max(700),
  sourceRefs: z.array(z.string().regex(/^S\d{1,2}$/)).min(1).max(8),
});

export const researchReportSchema = z.object({
  overview: citedClaimSchema,
  keyFindings: z.array(citedClaimSchema).min(3).max(8),
  audienceInsights: z.array(citedClaimSchema).min(2).max(6),
  searchOpportunities: z
    .array(
      z.object({
        query: z.string().trim().min(2).max(120),
        intent: z.enum(["informational", "inspirational", "commercial", "seasonal"]),
        rationale: z.string().trim().min(12).max(500),
        sourceRefs: z.array(z.string().regex(/^S\d{1,2}$/)).min(1).max(8),
      }),
    )
    .min(3)
    .max(8),
  contentAngles: z
    .array(
      z.object({
        angle: z.string().trim().min(8).max(180),
        format: z.string().trim().min(3).max(80),
        rationale: z.string().trim().min(12).max(500),
        sourceRefs: z.array(z.string().regex(/^S\d{1,2}$/)).min(1).max(8),
      }),
    )
    .min(3)
    .max(8),
});

export type ResearchReport = z.infer<typeof researchReportSchema>;

export interface ResearchSearchResult {
  title: string;
  url: string;
  canonicalUrl: string;
  publishedAt: string | null;
  excerpt: string;
  query: string;
}

export interface ResearchSourceView {
  id: string;
  title: string;
  sourceUrl: string;
  canonicalUrl: string;
  publishedAt: string | null;
  retrievedAt: string;
  excerpt: string;
  relevance: string | null;
}

export interface ResearchReportView {
  overview: { text: string; sourceIds: string[] };
  keyFindings: Array<{ text: string; sourceIds: string[] }>;
  audienceInsights: Array<{ text: string; sourceIds: string[] }>;
  searchOpportunities: Array<{
    query: string;
    intent: "informational" | "inspirational" | "commercial" | "seasonal";
    rationale: string;
    sourceIds: string[];
  }>;
  contentAngles: Array<{
    angle: string;
    format: string;
    rationale: string;
    sourceIds: string[];
  }>;
  searchQueries: string[];
  warnings: string[];
  provider: string;
  model: string;
  generatedAt: string;
}
