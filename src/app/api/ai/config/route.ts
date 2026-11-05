import { NextResponse } from "next/server";
import {
  aiConfigurationUpdateSchema,
} from "@/lib/ai-config-schema";
import {
  listAIConfigurations,
  saveAIConfigurations,
} from "@/server/ai/configuration";
import { isEncryptionKeyConfigured } from "@/server/ai/encryption";
import { hasSameOrigin } from "@/server/security/request-origin";
import { ZodError } from "zod";

export const runtime = "nodejs";

export async function GET() {
  try {
    const configurations = await listAIConfigurations();
    return NextResponse.json({
      configurations,
      encryptionKeyConfigured: isEncryptionKeyConfigured(),
    });
  } catch (error) {
    console.error("Could not read AI configuration metadata", error);
    return NextResponse.json(
      { error: "AI configuration is temporarily unavailable." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = aiConfigurationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "AI configuration is invalid.",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  if (!isEncryptionKeyConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set APP_ENCRYPTION_KEY to a strong 32-byte value and restart the server before saving credentials.",
      },
      { status: 503 },
    );
  }

  try {
    await saveAIConfigurations(
      parsed.data.map((configuration) => ({
        ...configuration,
        apiKey: configuration.apiKey || undefined,
      })),
    );
    return NextResponse.json({
      configurations: await listAIConfigurations(),
      message: "AI configuration saved. API keys are encrypted and never returned.",
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "AI configuration is invalid." }, { status: 422 });
    }
    console.error("Could not save AI configuration", error);
    const message =
      error instanceof Error && error.message.includes("API key is required")
        ? error.message
        : "Could not save AI configuration.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
