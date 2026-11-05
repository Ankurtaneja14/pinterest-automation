import { z } from "zod";
import type { AIStage } from "@/lib/ai-config-schema";

const providerResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.unknown() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

const testResponseSchema = z.object({}).passthrough();

export interface OpenAICompatibleConfiguration {
  stage: AIStage;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  retryLimit: number;
}

export interface ConnectionTestResult {
  ok: true;
  providerName: string;
  configuredModel: string;
  returnedModel: string | null;
  latencyMs: number;
  tokenUsage: {
    prompt: number | null;
    completion: number | null;
    total: number | null;
  } | null;
  jsonMode: "native" | "prompt";
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly category: "configuration" | "authentication" | "model" | "rate_limit" | "timeout" | "provider" | "response",
    readonly status?: number,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

function completionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function shouldFallbackToPromptOnly(status: number, responseText: string): boolean {
  const text = responseText.toLowerCase();
  if (
    status === 503 &&
    /all targets? (?:were )?skipped by pre-dispatch filters/.test(text)
  ) {
    return true;
  }
  if (status !== 400) {
    return false;
  }
  if (/thread creation failed with http 400/.test(text)) {
    return true;
  }
  return (
    (text.includes("response_format") ||
      text.includes("json_object") ||
      text.includes("json mode")) &&
    (text.includes("unsupported") ||
      text.includes("not support") ||
      text.includes("unknown parameter") ||
      text.includes("unrecognized"))
  );
}

function providerError(
  status: number,
  responseText: string,
  apiKey: string,
): AIProviderError {
  let detail: unknown;
  try {
    const body: unknown = JSON.parse(responseText);
    if (typeof body === "string") {
      detail = body;
    } else if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      const providerError = record.error;
      if (typeof providerError === "string") {
        detail = providerError;
      } else if (providerError && typeof providerError === "object") {
        detail = (providerError as Record<string, unknown>).message;
      }
      detail ??= record.message;
    }
  } catch {
    detail = undefined;
  }

  const safeDetail =
    typeof detail === "string"
      ? detail
          .replaceAll(apiKey, "[redacted]")
          .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
          .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240)
      : "";
  const diagnostic = safeDetail ? ` Provider detail: ${safeDetail}` : "";

  if (status === 401 || status === 403) {
    return new AIProviderError(
      `The provider rejected authentication. Verify the API key, authorization format, and permissions.${diagnostic}`,
      "authentication",
      status,
    );
  }
  if (status === 404) {
    return new AIProviderError(
      `The provider endpoint or model was not found. Check the base URL and model name.${diagnostic}`,
      "model",
      status,
    );
  }
  if (status === 429) {
    return new AIProviderError(
      `The provider rate-limited the test request. Check account limits and try again later.${diagnostic}`,
      "rate_limit",
      status,
    );
  }
  if (
    status === 400 &&
    /thread creation failed with http 400/.test(safeDetail.toLowerCase())
  ) {
    return new AIProviderError(
      `The request was retried without native JSON mode, but OmniRoute's Felo route still rejected thread creation. This is an upstream model-route compatibility or availability issue, not an API-key rejection. Select another chat-capable route or contact the OmniRoute administrator.${diagnostic}`,
      "model",
      status,
    );
  }
  return new AIProviderError(
    `The provider returned HTTP ${status}. Check provider availability and model configuration.${diagnostic}`,
    "provider",
    status,
  );
}

function validateCompletion(responseText: string, status: number) {
  let body: unknown;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new AIProviderError(
      "The provider returned invalid JSON for a successful request.",
      "response",
      status,
    );
  }

  const parsed = providerResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AIProviderError(
      "The HTTP request succeeded, but the response contained no usable model completion.",
      "response",
      status,
    );
  }

  const content = parsed.data.choices[0].message.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new AIProviderError(
      "The configured model returned an empty or non-text completion.",
      "response",
      status,
    );
  }

  let structuredContent: unknown;
  try {
    structuredContent = JSON.parse(content);
  } catch {
    throw new AIProviderError(
      "The model responded but did not produce the required structured JSON.",
      "response",
      status,
    );
  }

  if (!testResponseSchema.safeParse(structuredContent).success) {
    throw new AIProviderError(
      "The model responded, but its structured test result did not match the required format.",
      "response",
      status,
    );
  }

  return parsed.data;
}

async function requestCompletion(
  configuration: OpenAICompatibleConfiguration,
  jsonMode: boolean,
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<Response> {
  const endpoint = completionsUrl(configuration.baseUrl);
  try {
    return await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(configuration.requestTimeoutMs),
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: configuration.modelName,
        temperature: configuration.temperature,
        max_tokens: configuration.maxOutputTokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new AIProviderError(
        "The model request timed out. Increase the timeout or check provider latency.",
        "timeout",
      );
    }
    throw new AIProviderError(
      "Could not reach the provider. Check the base URL, network, and provider availability.",
      "provider",
    );
  }
}

function isRetryableAIError(error: unknown): error is AIProviderError {
  return (
    error instanceof AIProviderError &&
    (error.category === "response" ||
      error.category === "timeout" ||
      (error.category === "provider" &&
        (error.status === undefined || error.status >= 500)) ||
      (error.category === "rate_limit" && error.status === 429))
  );
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.min(250 * 2 ** attempt, 1_000)),
  );
}

function parseStructuredContent(content: string): unknown {
  const trimmed = content.trim();

  // 1. Direct parse attempt
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue
  }

  // 2. Standard markdown code fences (```json ... ``` or ``` ... ```)
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Continue
    }
  }

  // 3. Find outermost JSON object { ... }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue
    }
  }

  // 4. Find outermost JSON array [ ... ]
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue
    }
  }

  // Fallback to preserve native error
  return JSON.parse(fenced?.[1] ?? trimmed);
}

export async function generateStructuredJSON<T>(
  configuration: OpenAICompatibleConfiguration,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let lastError: unknown;
  let correctionNote = "";
  for (let attempt = 0; attempt <= configuration.retryLimit; attempt += 1) {
    const nativeJsonMode = attempt === 0;
    try {
      let response = await requestCompletion(configuration, nativeJsonMode, [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${userPrompt}${correctionNote}` },
      ]);
      let responseText = await response.text();

      if (shouldFallbackToPromptOnly(response.status, responseText)) {
        response = await requestCompletion(configuration, false, [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${userPrompt}${correctionNote}` },
        ]);
        responseText = await response.text();
      }

      if (!response.ok) {
        throw providerError(response.status, responseText, configuration.apiKey);
      }

      let body: unknown;
      try {
        body = JSON.parse(responseText);
      } catch {
        throw new AIProviderError(
          "The provider returned invalid JSON for a successful request.",
          "response",
          response.status,
        );
      }
      const parsedResponse = providerResponseSchema.safeParse(body);
      const content = parsedResponse.success
        ? parsedResponse.data.choices[0].message.content
        : undefined;
      if (typeof content !== "string" || !content.trim()) {
        throw new AIProviderError(
          "The configured model returned an empty or invalid completion.",
          "response",
          response.status,
        );
      }

      let decoded: unknown;
      try {
        decoded = parseStructuredContent(content);
      } catch {
        correctionNote =
          "\n\nYour previous response was not valid JSON. Return only one complete raw JSON object: no markdown fences, commentary, or trailing text.";
        throw new AIProviderError(
          "The model did not return valid structured JSON.",
          "response",
          response.status,
        );
      }
      const validated = schema.safeParse(decoded);
      if (!validated.success) {
        const issues = validated.error.issues
          .slice(0, 12)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("\n");
        correctionNote =
          "\n\nYour previous JSON did not match the required schema. Return a corrected complete JSON object. Fix these validation issues:\n" +
          issues;
        throw new AIProviderError(
          `The model response did not match the required structured format. Validation issues: ${issues}`,
          "response",
          response.status,
        );
      }
      return validated.data;
    } catch (error) {
      lastError = error;
      if (!isRetryableAIError(error) || attempt >= configuration.retryLimit) {
        throw error;
      }
      await retryDelay(attempt);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new AIProviderError(
    "The structured generation request exhausted its retry limit.",
    "provider",
  );
}

export async function testAIConnection(
  configuration: OpenAICompatibleConfiguration,
): Promise<ConnectionTestResult> {
  const startedAt = Date.now();
  const messages = [
    {
      role: "system" as const,
      content:
        'Return a JSON object with the fields "ok" set to true and "model" set to the model identifier.',
    },
    {
      role: "user" as const,
      content: "Run the connection test now. Confirm the configured model.",
    },
  ];
  for (let attempt = 0; attempt <= configuration.retryLimit; attempt += 1) {
    const nativeJsonMode = attempt === 0;
    let jsonMode: ConnectionTestResult["jsonMode"] = nativeJsonMode
      ? "native"
      : "prompt";

    try {
      let response = await requestCompletion(
        configuration,
        nativeJsonMode,
        messages,
      );
      let responseText = await response.text();

      if (shouldFallbackToPromptOnly(response.status, responseText)) {
        response = await requestCompletion(configuration, false, messages);
        jsonMode = "prompt";
        responseText = await response.text();
      }

      if (!response.ok) {
        throw providerError(response.status, responseText, configuration.apiKey);
      }

      const parsed = validateCompletion(responseText, response.status);
      return {
        ok: true,
        providerName: configuration.providerName,
        configuredModel: configuration.modelName,
        returnedModel: parsed.model ?? null,
        latencyMs: Date.now() - startedAt,
        tokenUsage: parsed.usage
          ? {
              prompt: parsed.usage.prompt_tokens ?? null,
              completion: parsed.usage.completion_tokens ?? null,
              total: parsed.usage.total_tokens ?? null,
            }
          : null,
        jsonMode,
      };
    } catch (error) {
      if (!isRetryableAIError(error) || attempt >= configuration.retryLimit) {
        throw error;
      }
      await retryDelay(attempt);
    }
  }

  throw new AIProviderError(
    "The connection test exhausted its retry limit.",
    "provider",
  );
}
