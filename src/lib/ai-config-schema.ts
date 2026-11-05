import { z } from "zod";

export const AI_STAGES = [
  "research",
  "idea_generation",
  "idea_evaluation",
  "content_generation",
  "image_prompt_generation",
  "image_generation",
] as const;

export const CHAT_AI_STAGES = AI_STAGES.filter(
  (stage): stage is Exclude<(typeof AI_STAGES)[number], "image_generation"> =>
    stage !== "image_generation",
);

export const aiStageSchema = z.enum(AI_STAGES);
export type AIStage = z.infer<typeof aiStageSchema>;
export type ChatAIStage = Exclude<AIStage, "image_generation">;

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-web";

const httpUrlSchema = z
  .string()
  .trim()
  .url("Enter a valid HTTP or HTTPS API base URL.")
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    },
    {
      message: "API URL must use HTTP or HTTPS and must not contain credentials or query parameters.",
    },
  );

const aiConfigurationObjectSchema = z.object({
  stage: aiStageSchema,
  providerName: z.string().trim().min(1).max(80),
  baseUrl: httpUrlSchema,
  modelName: z.string().trim().min(1).max(200),
  accountId: z.preprocess(
    (value) =>
      value === null ||
      (typeof value === "string" && value.trim().length === 0)
        ? undefined
        : value,
    z.string().trim().max(64).optional(),
  ),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(1).max(200_000),
  requestTimeoutMs: z.number().int().min(1_000).max(300_000),
  retryLimit: z.number().int().min(0).max(10),
});

export const aiConfigurationInputSchema = z.preprocess(
  (value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("stage" in value) ||
      value.stage !== "image_generation"
    ) {
      return value;
    }
    const modelName =
      "modelName" in value && typeof value["modelName"] === "string" && value["modelName"].trim()
        ? value["modelName"].trim()
        : DEFAULT_GEMINI_IMAGE_MODEL;
    const providerName =
      "providerName" in value && typeof value["providerName"] === "string" && value["providerName"].trim()
        ? value["providerName"].trim()
        : "Playwright Gemini";
    const baseUrl =
      "baseUrl" in value && typeof value["baseUrl"] === "string" && value["baseUrl"].trim()
        ? value["baseUrl"].trim()
        : "https://gemini.google.com/app";

    return {
      ...value,
      providerName,
      baseUrl,
      accountId: undefined,
      modelName,
    };
  },
  aiConfigurationObjectSchema,
);

export const aiConfigurationUpdateSchema = z
  .array(aiConfigurationInputSchema)
  .min(1)
  .max(AI_STAGES.length)
  .refine(
    (configurations) =>
      new Set(configurations.map((configuration) => configuration.stage)).size ===
      configurations.length,
    { message: "Each AI stage can only be configured once." },
  );

export const aiConnectionTestInputSchema = z.object({
  stage: aiStageSchema,
});
