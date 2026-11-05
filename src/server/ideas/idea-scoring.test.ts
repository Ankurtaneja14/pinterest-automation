import { describe, expect, it, vi } from "vitest";
import {
  calculateWeightedScore,
  rankScoredIdeas,
  scoreIdeasInBatches,
  selectDiverseIdeas,
  validateIdeaScores,
  type IdeaScoreEntry,
  type ScorableIdea,
} from "./idea-scoring";

function idea(
  id: string,
  contentFormat: string,
  searchIntent: string,
  trendClassification: string,
): ScorableIdea {
  return {
    id,
    title: `Idea ${id}`,
    coreConcept: "A useful, clearly explained Pinterest content concept.",
    explanation: "This explains a useful concept to the intended audience.",
    audienceSegment: "Apartment renters",
    audienceNeed: "Solve a storage problem.",
    searchIntent,
    keywords: ["storage ideas", "small spaces", "renter tips"],
    rationale: "Research excerpts support this practical topic.",
    visualDirection: "Show an organized bright apartment room.",
    contentFormat,
    trendClassification,
    destinationRelevance: "Relevant to the saved destination.",
    sourceIds: ["source-1"],
  };
}

function score(ideaId: string, value: number): IdeaScoreEntry {
  return {
    ideaId,
    trendRelevance: value,
    audienceResonance: value,
    searchPotential: value,
    clickPotential: value,
    visualAppeal: value,
    originality: value,
    evergreenValue: value,
    reasoning: "The idea has clear audience value and evidence-supported relevance.",
    strengths: ["Clear audience need"],
    weaknesses: [],
    improvementSuggestions: [],
  };
}

describe("idea quality scoring", () => {
  it("calculates a deterministic weighted score from seven dimensions", () => {
    expect(calculateWeightedScore(score("all-high", 10))).toBe(100);
    expect(calculateWeightedScore(score("all-low", 1))).toBe(10);
    expect(
      calculateWeightedScore({
        ...score("mixed", 1),
        audienceResonance: 10,
        searchPotential: 10,
      }),
    ).toBe(46);
  });

  it("validates complete unique score coverage and ranks by computed score", () => {
    const ideas = [
      idea("low", "List", "informational", "evergreen"),
      idea("high", "Guide", "seasonal", "seasonal"),
    ];
    const scores = [score("low", 4), score("high", 9)];
    expect(validateIdeaScores(ideas, scores)).toEqual(scores);
    expect(rankScoredIdeas(ideas, scores).map((entry) => entry.idea.id)).toEqual([
      "high",
      "low",
    ]);
    expect(() => validateIdeaScores(ideas, [score("high", 9)])).toThrow(
      "unexpected number",
    );
    expect(() =>
      validateIdeaScores(ideas, [score("high", 9), score("high", 8)]),
    ).toThrow("duplicate scores");
    expect(() =>
      validateIdeaScores(ideas, [score("high", 9), score("unknown", 8)]),
    ).toThrow("outside the current schedule");
  });

  it("selects a diverse subset by format, intent, and trend before falling back to rank", () => {
    const ideas = [
      idea("top", "Carousel", "informational", "evergreen"),
      idea("diverse", "Checklist", "seasonal", "seasonal"),
      idea("similar", "Carousel", "informational", "evergreen"),
    ];
    const ranked = rankScoredIdeas(
      ideas,
      [score("top", 10), score("diverse", 8), score("similar", 9)],
    );
    expect(ranked.map((entry) => entry.idea.id)).toEqual([
      "top",
      "similar",
      "diverse",
    ]);

    const selected = selectDiverseIdeas(ranked, 2);
    expect(selected.map((entry) => entry.idea.id)).toEqual(["top", "diverse"]);
    expect(new Set(selected.map((entry) => entry.idea.contentFormat)).size).toBe(2);
    expect(selected[1].selectionReason).toContain("new content format");

    expect(selectDiverseIdeas(ranked, 8)).toHaveLength(3);
    expect(() => selectDiverseIdeas(ranked, 0)).toThrow("invalid requested pin count");
  });

  it("scores ideas in bounded batches and validates each provider response", async () => {
    const ideas = Array.from({ length: 10 }, (_, index) =>
      idea(`idea-${index}`, "Guide", "informational", "evergreen"),
    );
    const calls: string[][] = [];
    const provider = {
      score: vi.fn(async (_system: string, _prompt: string, ids: string[]) => {
        calls.push(ids);
        return { scores: ids.map((id) => score(id, 7)) };
      }),
    };

    const scores = await scoreIdeasInBatches(ideas, provider);
    expect(calls.map((batch) => batch.length)).toEqual([8, 2]);
    expect(scores).toHaveLength(10);
  });
});
