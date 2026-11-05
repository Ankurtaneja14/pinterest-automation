import { describe, expect, it, vi } from "vitest";
import type { NicheSchedule } from "@prisma/client";
import {
  buildResearchQueries,
  ResearchRetrievalError,
  retrieveResearchSources,
  researchReportForStorage,
  synthesizeResearchReport,
  validateResearchCitations,
} from "./research-service";
import type {
  ResearchReport,
  ResearchSearchResult,
} from "./schemas";

const schedule = {
  niche: "Small-space home organization",
  targetCountry: "United States",
  targetAudience: "Apartment renters",
  language: "English",
  destinationUrl: "https://example.com/organization",
} as Pick<
  NicheSchedule,
  "niche" | "targetCountry" | "targetAudience" | "language" | "destinationUrl"
>;

function result(id: number, query = "storage ideas"): ResearchSearchResult {
  return {
    title: `Source ${id}`,
    url: `https://source${id}.example/article`,
    canonicalUrl: `https://source${id}.example/article`,
    publishedAt: null,
    excerpt: `Source ${id} has a sufficiently descriptive excerpt for evidence based research.`,
    query,
  };
}

function report(references: string[] = ["S1"]): ResearchReport {
  return {
    overview: { text: "A source-grounded overview for this audience.", sourceRefs: references },
    keyFindings: [
      { text: "Finding one is grounded in the supplied search evidence.", sourceRefs: references },
      { text: "Finding two is grounded in the supplied search evidence.", sourceRefs: references },
      { text: "Finding three is grounded in the supplied search evidence.", sourceRefs: references },
    ],
    audienceInsights: [
      { text: "Audience insight one is evidence-based and cited.", sourceRefs: references },
      { text: "Audience insight two is evidence-based and cited.", sourceRefs: references },
    ],
    searchOpportunities: [
      {
        query: "renter-friendly organization",
        intent: "informational",
        rationale: "The source excerpts describe this recurring audience need.",
        sourceRefs: references,
      },
      {
        query: "small apartment storage",
        intent: "inspirational",
        rationale: "The source excerpts provide relevant small-space context.",
        sourceRefs: references,
      },
      {
        query: "closet organization ideas",
        intent: "commercial",
        rationale: "The source excerpts support practical organization topics.",
        sourceRefs: references,
      },
    ],
    contentAngles: [
      {
        angle: "Make the most of a compact entryway",
        format: "Step-by-step guide",
        rationale: "The source excerpts discuss practical storage constraints.",
        sourceRefs: references,
      },
      {
        angle: "Removable storage upgrades for renters",
        format: "Idea list",
        rationale: "The source excerpts support reversible organization options.",
        sourceRefs: references,
      },
      {
        angle: "Small closet reset checklist",
        format: "Checklist",
        rationale: "The source excerpts support a practical audience solution.",
        sourceRefs: references,
      },
    ],
  };
}

describe("Research retrieval and evidence validation", () => {
  it("builds localized, current searches and keeps unique source URLs", async () => {
    const queries = buildResearchQueries(schedule, 2026);
    expect(queries).toHaveLength(4);
    expect(queries[0]).toContain("United States 2026");
    expect(queries[1]).toContain("Apartment renters");

    const provider = {
      search: vi.fn(async (query: string) =>
        query === queries[0]
          ? [result(1, query), result(2, query)]
          : [result(2, query), result(3, query)],
      ),
    };
    const plan = await retrieveResearchSources(schedule, provider);

    expect(provider.search).toHaveBeenCalledTimes(4);
    expect(plan.sources.map((source) => source.canonicalUrl)).toEqual([
      "https://source1.example/article",
      "https://source2.example/article",
      "https://source3.example/article",
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("retains partial search warnings and fails explicitly when evidence is insufficient", async () => {
    let call = 0;
    const partial = await retrieveResearchSources(schedule, {
      search: async () => {
        call += 1;
        if (call === 1) {
          throw new Error("search unavailable");
        }
        return [result(call), result(call + 10)];
      },
    });
    expect(partial.sources.length).toBeGreaterThanOrEqual(3);
    expect(partial.warnings).toHaveLength(1);
    expect(partial.warnings[0]).toContain("search unavailable");

    await expect(
      retrieveResearchSources(schedule, { search: async () => [] }),
    ).rejects.toBeInstanceOf(ResearchRetrievalError);
  });

  it("includes the collected evidence in an explicitly untrusted synthesis prompt", async () => {
    const sources = [result(1), result(2), result(3)];
    const generate = vi.fn(async (systemPrompt: string, userPrompt: string) => {
      expect(systemPrompt).toContain("untrusted data");
      expect(userPrompt).toContain(schedule.niche);
      return report();
    });
    const synthesized = await synthesizeResearchReport(
      schedule,
      sources,
      { generate },
    );

    expect(synthesized.keyFindings).toHaveLength(3);
    expect(generate.mock.calls[0][0]).toContain("untrusted data");
    expect(generate.mock.calls[0][1]).toContain("[S3]");
    expect(generate.mock.calls[0][1]).toContain("Do not claim search-volume data");
    expect(generate.mock.calls[0][1]).toContain(schedule.niche);
  });

  it("rejects citations to sources that were not retrieved", () => {
    expect(() => validateResearchCitations(report(["S4"]), 3)).toThrow(
      "cited a source that was not included",
    );
    expect(validateResearchCitations(report(["S2"]), 3).overview.sourceRefs).toEqual([
      "S2",
    ]);
  });

  it("persists validated source IDs in every report claim", () => {
    const stored = researchReportForStorage(
      report(["S1", "S2"]),
      [
        { ref: "S1", id: "db-source-1" },
        { ref: "S2", id: "db-source-2" },
      ],
      {
        queries: ["query"],
        warnings: [],
        provider: "OmniRoute",
        model: "auto/fast",
        generatedAt: new Date("2026-11-03T00:00:00.000Z"),
      },
    );

    expect(stored.overview.sourceIds).toEqual(["db-source-1", "db-source-2"]);
    expect(stored.keyFindings[0].sourceIds).toEqual([
      "db-source-1",
      "db-source-2",
    ]);
    expect(stored.generatedAt).toBe("2026-11-03T00:00:00.000Z");
  });
});
