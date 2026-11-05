import { describe, expect, it, vi } from "vitest";
import type { AIConfiguration } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aIConfiguration: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { listAIConfigurations } from "./configuration";

describe("AI configuration redaction", () => {
  it("returns key-presence metadata without exposing ciphertext", async () => {
    const encryptedCredential = "v1:nonce:tag:ciphertext";
    const savedConfiguration: AIConfiguration = {
      id: "configuration-1",
      stage: "research",
      providerName: "Example provider",
      baseUrl: "https://api.example.com/v1",
      accountId: null,
      apiKeyEncrypted: encryptedCredential,
      modelName: "example-model",
      temperature: 0.7,
      maxOutputTokens: 4096,
      requestTimeoutMs: 60_000,
      retryLimit: 3,
      enabled: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    vi.mocked(prisma.aIConfiguration.findMany).mockResolvedValue([
      savedConfiguration,
    ]);

    const result = await listAIConfigurations();
    const research = result.find(({ stage }) => stage === "research");

    expect(research).toMatchObject({
      providerName: "Example provider",
      modelName: "example-model",
      hasApiKey: true,
      enabled: true,
    });
    expect(result).toHaveLength(6);
    expect(JSON.stringify(result)).not.toContain(encryptedCredential);
    expect(JSON.stringify(result)).not.toContain("apiKeyEncrypted");
  });
});
