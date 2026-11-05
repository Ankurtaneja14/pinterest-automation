import { describe, expect, it, vi } from "vitest";
import {
  createIdeaKey,
  generateDistinctIdeas,
  type IdeaGenerationProvider,
} from "./idea-generation";
import type { IdeaDraft } from "./idea-schema";

const sources = [
  {
    id: "stored-source-1",
    title: "Source one",
    sourceUrl: "https://one.example/article",
    excerpt: "Evidence excerpt for a useful Pinterest idea.",
  },
  {
    id: "stored-source-2",
    title: "Source two",
    sourceUrl: "https://two.example/article",
    excerpt: "Another evidence excerpt for a useful Pinterest idea.",
  },
];

const schedule = {
  niche: "Small-space organization",
  targetCountry: "United States",
  targetAudience: "Apartment renters",
  language: "English",
  destinationUrl: "https://example.com/organization",
  researchIdeasCount: 6,
};

function draft(index: number, title = `Small space idea ${index}`): IdeaDraft {
  return {
    title,
    coreConcept: `A practical organization approach number ${index}.`,
    explanation: `Show renters how to use this practical storage approach number ${index}.`,
    audienceSegment: "Apartment renters",
    audienceNeed: "Make limited storage easier to use.",
    searchIntent: "informational",
    keywords: ["small-space storage", "renter organization", `storage idea ${index}`],
    rationale: `The saved research evidence supports this idea number ${index}.`,
    visualDirection: `Show a bright compact apartment with clear labeled storage zone ${index}.`,
    contentFormat: "Step-by-step guide",
    trendClassification: "evergreen",
    destinationRelevance: `This idea relates to the scheduled organization destination ${index}.`,
    sourceRefs: ["S1"],
  };
}

describe("research-based idea generation", () => {
  it("generates the requested quantity in bounded batches and maps source citations", async () => {
    let next = 1;
    const progress: number[] = [];
    const prompts: string[] = [];
    const provider: IdeaGenerationProvider = {
      generate: async (_system, prompt, count) => {
        prompts.push(prompt);
        return { ideas: Array.from({ length: count }, () => draft(next++)) };
      },
    };

    const generated = await generateDistinctIdeas({
      schedule,
      report: { overview: { text: "Cited overview." } },
      sources,
      existingIdeas: [],
      provider,
      onProgress: async (count) => {
        progress.push(count);
      },
    });

    expect(generated).toHaveLength(schedule.researchIdeasCount);
    expect(generated.map((idea) => idea.sourceIds)).toEqual(
      Array.from({ length: 6 }, () => ["stored-source-1"]),
    );
    expect(new Set(generated.map((idea) => idea.ideaKey)).size).toBe(6);
    expect(progress).toEqual([5, 6]);
    expect(prompts[0]).toContain("Treat the research report as a summary, not primary evidence");
    expect(prompts[0]).toContain("state when the evidence is limited");
  });

  it("excludes existing titles, fills only the missing count, and skips duplicates", async () => {
    const promptSpy = vi.fn();
    let call = 0;
    const provider: IdeaGenerationProvider = {
      generate: async (_system, prompt, count) => {
        promptSpy(prompt);
        call += 1;
        return {
          ideas: [
            draft(
              call,
              call === 1 ? "SMALL-SPACE IDEA 1!" : "A distinct compact storage guide",
            ),
          ].slice(0, count),
        };
      },
    };
    const generated = await generateDistinctIdeas({
      schedule: { ...schedule, researchIdeasCount: 2 },
      report: {},
      sources,
      existingIdeas: [
        { title: "Small space idea 1", ideaKey: createIdeaKey("Small space idea 1") },
      ],
      provider,
    });

    expect(generated).toHaveLength(1);
    expect(generated[0].draft.title).toBe("A distinct compact storage guide");
    expect(call).toBe(2);
    expect(promptSpy.mock.calls[0][0]).toContain("Small space idea 1");
  });

  it("rejects citations to sources outside the retrieved evidence", async () => {
    const provider: IdeaGenerationProvider = {
      generate: async (_system, _prompt, count) => ({
        ideas: Array.from({ length: count }, (_, index) => ({
          ...draft(index),
          sourceRefs: ["S9"],
        })),
      }),
    };

    await expect(
      generateDistinctIdeas({
        schedule: { ...schedule, researchIdeasCount: 1 },
        report: {},
        sources,
        existingIdeas: [],
        provider,
      }),
    ).rejects.toThrow("not included in the report");
  });
});
