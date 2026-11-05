import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAIContentGenerationProvider,
  generateContentPackages,
  validateContentPackages,
  type ContentDraft,
  type ContentGenerationProvider,
  type ContentIdeaInput,
} from "./content-generation";
import type { OpenAICompatibleConfiguration } from "@/server/ai/openai-compatible";

const ideas: ContentIdeaInput[] = Array.from({ length: 5 }, (_, index) => ({
  id: `selected-${index + 1}`,
  title: `Renter storage idea ${index + 1}`,
  coreConcept: `A practical storage concept for renters number ${index + 1}.`,
  explanation: `Explain how to apply the renter storage concept number ${index + 1}.`,
  audienceSegment: "Apartment renters",
  audienceNeed: "Make limited storage easier to use.",
  keywords: ["renter storage", "small apartment", `organization ${index + 1}`],
  visualDirection: "Show a bright compact apartment with clear labeled zones.",
  contentFormat: "Step-by-step guide",
  destinationRelevance: "Supports the scheduled renter organization destination.",
  finalScore: 82 - index,
}));

const configuration: OpenAICompatibleConfiguration = {
  stage: "content_generation",
  providerName: "Test provider",
  baseUrl: "https://api.example.com/v1",
  apiKey: "test-secret",
  modelName: "test-model",
  temperature: 0.3,
  maxOutputTokens: 4096,
  requestTimeoutMs: 60_000,
  retryLimit: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function content(ideaId: string): ContentDraft {
  return {
    ideaId,
    pinterestTitle: `Smart renter storage guide for ${ideaId}`,
    description:
      "Use this practical renter-friendly storage guide to make a small apartment feel more organized. Visit the scheduled destination to explore the topic further.",
    hashtags: ["#RenterTips", "#SmallSpace", "#StorageIdeas"],
    keywords: ["renter storage ideas", "small apartment organization", "space saving tips"],
    imagePrompt:
      "Create a vertical Pinterest pin showing a bright compact apartment with an organized shelf, clean editorial typography, warm neutral palette, soft natural lighting, and generous readable safe margins.",
  };
}

describe("selected-idea content generation", () => {
  it("generates valid packages in bounded batches and reports progress", async () => {
    const calls: string[][] = [];
    const progress: number[] = [];
    const provider: ContentGenerationProvider = {
      generate: async (_system, prompt, ideaIds) => {
        calls.push(ideaIds);
        expect(prompt).toContain("https://example.com/organization");
        return { packages: ideaIds.map(content) };
      },
    };

    const packages = await generateContentPackages({
      niche: "Home organization",
      targetCountry: "United States",
      targetAudience: "Apartment renters",
      language: "English",
      destinationUrl: "https://example.com/organization",
      ideas,
      provider,
      onProgress: async (count) => {
        progress.push(count);
      },
    });

    expect(calls.map((batch) => batch.length)).toEqual([3, 2]);
    expect(packages.map((item) => item.ideaId)).toEqual(ideas.map((idea) => idea.id));
    expect(progress).toEqual([3, 5]);
  });

  it("rejects missing, duplicate, and unselected idea packages", () => {
    expect(() => validateContentPackages(["one", "two"], [content("one")])).toThrow(
      "unexpected number",
    );
    expect(() =>
      validateContentPackages(["one", "two"], [content("one"), content("one")]),
    ).toThrow("duplicate packages");
    expect(() =>
      validateContentPackages(["one"], [content("unselected")]),
    ).toThrow("unselected idea");
  });

  it("maps omitted idea IDs by batch order and normalizes hashtag labels", async () => {
    const modelPackage = {
      pinterestTitle: "Smart renter storage guide",
      description:
        "Use this practical renter-friendly storage guide to make a small apartment feel more organized. Visit the scheduled destination to explore the topic further.",
      hashtags: ["Renter Tips", "small-space", "#Storage Ideas"],
      keywords: ["renter storage ideas", "small apartment organization", "space saving tips"],
      imagePrompt:
        "Create a vertical Pinterest pin showing a bright compact apartment with an organized shelf, clean editorial typography, warm neutral palette, soft natural lighting, and generous readable safe margins.",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify({ packages: [modelPackage] }) } },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = createAIContentGenerationProvider(configuration);

    await expect(
      provider.generate("System", "Prompt", ["idea-1"]),
    ).resolves.toMatchObject({
      packages: [
        {
          ideaId: "idea-1",
          hashtags: ["#RenterTips", "#smallspace", "#StorageIdeas"],
        },
      ],
    });
  });

  it("validates the generated content fields and requires selected ideas", async () => {
    const malformed: ContentGenerationProvider = {
      generate: async (_system, _prompt, ids) => ({
        packages: ids.map((ideaId) => ({
          ...content(ideaId),
          hashtags: ["invalid tag"],
        })),
      }),
    };
    await expect(
      generateContentPackages({
        niche: "Home organization",
        targetCountry: "United States",
        targetAudience: "Apartment renters",
        language: "English",
        destinationUrl: "https://example.com/organization",
        ideas: [ideas[0]],
        provider: malformed,
      }),
    ).rejects.toThrow();

    await expect(
      generateContentPackages({
        niche: "Home organization",
        targetCountry: "United States",
        targetAudience: "Apartment renters",
        language: "English",
        destinationUrl: "https://example.com/organization",
        ideas: [],
        provider: { generate: vi.fn() },
      }),
    ).rejects.toThrow("Select at least one scored idea");
  });
});
