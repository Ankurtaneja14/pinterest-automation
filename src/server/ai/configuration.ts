import { AI_STAGES, type AIStage } from "@/lib/ai-config-schema";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "./encryption";

export interface PublicAIConfiguration {
  stage: AIStage;
  providerName: string;
  baseUrl: string;
  modelName: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  retryLimit: number;
  enabled: boolean;
  hasApiKey: boolean;
  updatedAt: string | null;
}

export async function listAIConfigurations(): Promise<PublicAIConfiguration[]> {
  const saved = await prisma.aIConfiguration.findMany();
  const byStage = new Map(saved.map((configuration) => [configuration.stage, configuration]));

  return AI_STAGES.map((stage) => {
    const configuration = byStage.get(stage);
    return {
      stage,
      providerName: configuration?.providerName ?? "",
      baseUrl: configuration?.baseUrl ?? "",
      modelName: configuration?.modelName ?? "",
      temperature: configuration?.temperature ?? 0.7,
      maxOutputTokens: configuration?.maxOutputTokens ?? 4096,
      requestTimeoutMs: configuration?.requestTimeoutMs ?? 60_000,
      retryLimit: configuration?.retryLimit ?? 3,
      enabled: configuration?.enabled ?? false,
      hasApiKey: Boolean(configuration?.apiKeyEncrypted),
      updatedAt: configuration?.updatedAt.toISOString() ?? null,
    };
  });
}

export interface AIConfigurationUpdate {
  stage: AIStage;
  providerName: string;
  baseUrl: string;
  accountId?: string;
  modelName: string;
  apiKey?: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  retryLimit: number;
}

export async function saveAIConfigurations(
  configurations: AIConfigurationUpdate[],
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    for (const configuration of configurations) {
      const current = await transaction.aIConfiguration.findUnique({
        where: { stage: configuration.stage },
      });
      const suppliedKey = configuration.apiKey;
      const switchingImageProvider =
        configuration.stage === "image_generation" &&
        current?.providerName !== undefined &&
        current.providerName !== configuration.providerName;
      if ((!current || switchingImageProvider) && !suppliedKey) {
        throw new Error(
          switchingImageProvider
            ? "A new Hugging Face API key is required when switching the image provider."
            : `An API key is required when configuring the ${configuration.stage} stage for the first time.`,
        );
      }

      const apiKeyEncrypted = suppliedKey
        ? encryptSecret(suppliedKey)
        : current?.apiKeyEncrypted;
      if (!apiKeyEncrypted) {
        throw new Error(`No API key is available for the ${configuration.stage} stage.`);
      }

      const data = {
        providerName: configuration.providerName,
        baseUrl: configuration.baseUrl,
        accountId:
          configuration.stage === "image_generation"
            ? null
            : configuration.accountId ?? current?.accountId ?? null,
        apiKeyEncrypted,
        modelName: configuration.modelName,
        temperature: configuration.temperature,
        maxOutputTokens: configuration.maxOutputTokens,
        requestTimeoutMs: configuration.requestTimeoutMs,
        retryLimit: configuration.retryLimit,
        enabled: true,
      };

      await transaction.aIConfiguration.upsert({
        where: { stage: configuration.stage },
        create: { stage: configuration.stage, ...data },
        update: data,
      });
    }
  });
}

export async function getAIConfigurationForStage(stage: AIStage) {
  const configuration = await prisma.aIConfiguration.findUnique({
    where: { stage },
  });
  if (!configuration || !configuration.enabled) {
    throw new Error(`Save and enable the ${stage} configuration before testing it.`);
  }
  return {
    stage: configuration.stage as AIStage,
    providerName: configuration.providerName,
    baseUrl: configuration.baseUrl,
    accountId: configuration.accountId,
    apiKey: decryptSecret(configuration.apiKeyEncrypted),
    modelName: configuration.modelName,
    temperature: configuration.temperature,
    maxOutputTokens: configuration.maxOutputTokens,
    requestTimeoutMs: configuration.requestTimeoutMs,
    retryLimit: configuration.retryLimit,
  };
}

export async function getAIConfigurationForTest(stage: AIStage) {
  return getAIConfigurationForStage(stage);
}
