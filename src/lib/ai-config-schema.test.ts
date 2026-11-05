import { describe, expect, it } from "vitest";
import {
  aiConfigurationUpdateSchema,
  DEFAULT_GEMINI_IMAGE_MODEL,
} from "./ai-config-schema";

const configuration = {
  providerName: "Example provider",
  baseUrl: "https://api.example.com/v1",
  modelName: "test-model",
  temperature: 0.7,
  maxOutputTokens: 4096,
  requestTimeoutMs: 60_000,
  retryLimit: 3,
};

describe("AI configuration schema", () => {
  it("normalizes the blank Account ID field on chat-stage settings", () => {
    const result = aiConfigurationUpdateSchema.safeParse([
      { ...configuration, stage: "research", accountId: "" },
    ]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].accountId).toBeUndefined();
    }
  });

  it("sets default Gemini image settings and drops any account ID", () => {
    const result = aiConfigurationUpdateSchema.safeParse([
      {
        ...configuration,
        stage: "image_generation",
        providerName: "",
        baseUrl: "",
        accountId: "0123456789abcdef0123456789abcdef",
        modelName: "",
      },
    ]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).toMatchObject({
        providerName: "Playwright Gemini",
        baseUrl: "https://gemini.google.com/app",
        modelName: DEFAULT_GEMINI_IMAGE_MODEL,
      });
      expect(result.data[0].accountId).toBeUndefined();
    }
  });

  it("accepts valid image_generation configuration", () => {
    const result = aiConfigurationUpdateSchema.safeParse([
      {
        ...configuration,
        stage: "image_generation",
        modelName: "gemini-web",
      },
    ]);

    expect(result.success).toBe(true);
  });
});
