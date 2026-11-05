import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIProviderError,
  generateStructuredJSON,
  testAIConnection,
  type OpenAICompatibleConfiguration,
} from "./openai-compatible";
import { z } from "zod";

const configuration: OpenAICompatibleConfiguration = {
  stage: "research",
  providerName: "Test provider",
  baseUrl: "https://api.example.com/v1",
  apiKey: "test-secret",
  modelName: "test-model",
  temperature: 0.7,
  maxOutputTokens: 4096,
  requestTimeoutMs: 60_000,
  retryLimit: 3,
};

function completionResponse(content: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      model: "returned-model",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible connection test", () => {
  it("validates a structured model completion and returns safe metadata", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe("https://api.example.com/v1/chat/completions");
        expect(init?.headers).toMatchObject({
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        });

        return completionResponse('{"ok":true,"model":"test-model"}');
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await testAIConnection(configuration);

    expect(result).toMatchObject({
      ok: true,
      providerName: "Test provider",
      configuredModel: "test-model",
      returnedModel: "returned-model",
      tokenUsage: { prompt: 11, completion: 7, total: 18 },
      jsonMode: "native",
    });
    expect(JSON.stringify(result)).not.toContain(configuration.apiKey);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/chat/completions",
    );
  });

  it("reports sanitized authentication details without leaking credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "Invalid key: test-secret (Bearer test-secret)",
              },
            }),
            { status: 401 },
          ),
      ),
    );

    try {
      await testAIConnection(configuration);
      throw new Error("Expected the authentication failure to reject.");
    } catch (error) {
      expect(error).toMatchObject({ category: "authentication", status: 401 });
      const errorMessage = error instanceof Error ? error.message : String(error);
      expect(errorMessage).toContain("Invalid key: [redacted]");
      expect(errorMessage).not.toContain("test-secret");
    }
  });

  it("retries without response_format only when JSON mode is explicitly unsupported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "response_format is unsupported" }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        completionResponse('{"ok":true,"model":"test-model"}'),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await testAIConnection(configuration);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));

    expect(result.jsonMode).toBe("prompt");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(secondBody).not.toHaveProperty("response_format");
  });

  it("retries prompt-only when OmniRoute filters every target for native JSON mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "Service temporarily unavailable: all targets were skipped by pre-dispatch filters",
            },
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        completionResponse('{"ok":true,"model":"test-model"}'),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(testAIConnection(configuration)).resolves.toMatchObject({
      ok: true,
      configuredModel: "test-model",
      jsonMode: "prompt",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0][1]?.body)),
    ).toHaveProperty("response_format");
    expect(
      JSON.parse(String(fetchMock.mock.calls[1][1]?.body)),
    ).not.toHaveProperty("response_format");
  });

  it("retries prompt-only when an OmniRoute target rejects JSON-mode thread creation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "felo/felo-social: model — [400]: Felo thread creation failed with HTTP 400 (HTTP 400)",
            },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        completionResponse('{"ok":true,"model":"test-model"}'),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(testAIConnection(configuration)).resolves.toMatchObject({
      ok: true,
      configuredModel: "test-model",
      jsonMode: "prompt",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0][1]?.body)),
    ).toHaveProperty("response_format");
    expect(
      JSON.parse(String(fetchMock.mock.calls[1][1]?.body)),
    ).not.toHaveProperty("response_format");
  });

  it("explains when a Felo route still rejects prompt-only thread creation", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message:
              "felo/felo-social: model — [400]: Felo thread creation failed with HTTP 400 (HTTP 400)",
          },
        }),
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      testAIConnection({ ...configuration, retryLimit: 0 }),
    ).rejects.toMatchObject({
      category: "model",
      status: 400,
      message: expect.stringContaining("not an API-key rejection"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed and empty model completions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => completionResponse("not structured JSON")),
    );
    await expect(
      testAIConnection({ ...configuration, retryLimit: 0 }),
    ).rejects.toMatchObject({ category: "response" });

    vi.stubGlobal("fetch", vi.fn(async () => completionResponse("  ")));
    await expect(
      testAIConnection({ ...configuration, retryLimit: 0 }),
    ).rejects.toMatchObject({ category: "response" });
  });

  it("accepts a valid JSON object even when the provider model varies its fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => completionResponse('{"connected":true,"provider":"upstream"}')),
    );

    await expect(testAIConnection(configuration)).resolves.toMatchObject({
      ok: true,
      configuredModel: "test-model",
    });
  });

  it("retries an empty completion in prompt mode and succeeds on a usable response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completionResponse(""))
      .mockResolvedValueOnce(
        completionResponse('{"connected":true,"provider":"upstream"}'),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(testAIConnection(configuration)).resolves.toMatchObject({
      ok: true,
      configuredModel: "test-model",
      jsonMode: "prompt",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toHaveProperty(
      "response_format",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).not.toHaveProperty(
      "response_format",
    );
  });

  it("reports timeouts distinctly", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(timeout)));

    await expect(
      testAIConnection({ ...configuration, retryLimit: 0 }),
    ).rejects.toBeInstanceOf(AIProviderError);
    await expect(
      testAIConnection({ ...configuration, retryLimit: 0 }),
    ).rejects.toMatchObject({ category: "timeout" });
  });
});

describe("structured JSON generation", () => {
  it("falls back to prompt-only when every OmniRoute target filters JSON mode", async () => {
    const schema = z.object({ ideas: z.array(z.string()) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "Service temporarily unavailable: all targets were skipped by pre-dispatch filters",
            },
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(completionResponse('{"ideas":["one","two"]}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateStructuredJSON(configuration, "Return JSON.", "Score ideas.", schema),
    ).resolves.toEqual({ ideas: ["one", "two"]});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0][1]?.body)),
    ).toHaveProperty("response_format");
    expect(
      JSON.parse(String(fetchMock.mock.calls[1][1]?.body)),
    ).not.toHaveProperty("response_format");
  });

  it("retries Felo thread creation 400 responses without native JSON mode", async () => {
    const schema = z.object({ ideas: z.array(z.string()) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "felo/felo-social: model — [400]: Felo thread creation failed with HTTP 400 (HTTP 400)",
            },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(completionResponse('{"ideas":["one","two"]}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateStructuredJSON(configuration, "Return JSON.", "Score ideas.", schema),
    ).resolves.toEqual({ ideas: ["one", "two"]});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0][1]?.body)),
    ).toHaveProperty("response_format");
    expect(
      JSON.parse(String(fetchMock.mock.calls[1][1]?.body)),
    ).not.toHaveProperty("response_format");
  });

  it("accepts a JSON object returned inside a markdown code fence", async () => {
    const schema = z.object({ ideas: z.array(z.string()) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        completionResponse('```json\n{"ideas":["one","two"]}\n```'),
      ),
    );

    await expect(
      generateStructuredJSON(
        configuration,
        "Return JSON.",
        "Create ideas.",
        schema,
      ),
    ).resolves.toEqual({ ideas: ["one", "two"] });
  });

  it("asks the model to return raw JSON after malformed output", async () => {
    const schema = z.object({ ideas: z.array(z.string()) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completionResponse("Here is your result: {broken}"))
      .mockResolvedValueOnce(completionResponse('{"ideas":["repaired"]}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateStructuredJSON(
        { ...configuration, retryLimit: 1 },
        "Return JSON.",
        "Create ideas.",
        schema,
      ),
    ).resolves.toEqual({ ideas: ["repaired"] });
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryBody.messages[1].content).toContain("no markdown fences");
  });

  it("uses schema validation feedback to repair an invalid first completion", async () => {
    const schema = z.object({
      keyFindings: z
        .array(z.object({ text: z.string(), sourceRefs: z.array(z.string()) }))
        .min(1),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        completionResponse('{"keyFindings":[{"text":"missing citation"}]}'),
      )
      .mockResolvedValueOnce(
        completionResponse(
          '{"keyFindings":[{"text":"supported","sourceRefs":["S1"]}]}',
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateStructuredJSON(
        { ...configuration, retryLimit: 1 },
        "Return a cited research report.",
        "Create one cited finding.",
        schema,
      ),
    ).resolves.toEqual({
      keyFindings: [{ text: "supported", sourceRefs: ["S1"] }],
    });

    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryBody).not.toHaveProperty("response_format");
    expect(retryBody.messages[1].content).toContain(
      "keyFindings.0.sourceRefs",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
