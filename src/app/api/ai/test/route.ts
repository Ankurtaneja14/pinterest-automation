import { NextResponse } from "next/server";
import { aiConnectionTestInputSchema } from "@/lib/ai-config-schema";
import { getAIConfigurationForTest } from "@/server/ai/configuration";
import { AIProviderError, testAIConnection } from "@/server/ai/openai-compatible";
import { getPlaywrightBrowserStatus } from "@/server/browser/playwright-service";
import { hasSameOrigin } from "@/server/security/request-origin";

export const runtime = "nodejs";
export const maxDuration = 310;

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = aiConnectionTestInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A supported AI stage is required." }, { status: 422 });
  }

  try {
    if (parsed.data.stage === "image_generation") {
      const startedAt = Date.now();
      const status = await getPlaywrightBrowserStatus();
      if (!status.ready) {
        return NextResponse.json(
          {
            error:
              status.error ||
              "Playwright browser automation is not available. Check browser installation.",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({
        ok: true,
        providerName: "Playwright (Gemini Semi-Automated)",
        configuredModel: "gemini.google.com/app",
        returnedModel: status.executablePath ? "Chromium / Chrome" : "System Browser",
        latencyMs: Date.now() - startedAt,
        tokenUsage: null,
        jsonMode: "prompt",
        imageWidth: null,
        imageHeight: null,
      });
    }

    const configuration = await getAIConfigurationForTest(parsed.data.stage);
    const result = await testAIConnection(configuration);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AIProviderError) {
      return NextResponse.json(
        { error: error.message, category: error.category, status: error.status ?? null },
        { status: error.status === 401 || error.status === 403 ? 422 : 502 },
      );
    }
    const message =
      error instanceof Error &&
      error.message.startsWith("Save and enable the ")
        ? error.message
        : "The connection test failed before reaching a successful model response.";
    if (message !== "The connection test failed before reaching a successful model response.") {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("AI provider connection test failed", error);
    return NextResponse.json(
      {
        error: message,
        category: "configuration",
      },
      { status: 503 },
    );
  }
}
