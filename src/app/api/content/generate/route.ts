import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  ContentGenerationError,
  enqueueContentGeneration,
  processContentGeneration,
} from "@/server/content/content-persistence";
import { hasSameOrigin } from "@/server/security/request-origin";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  researchSessionId: z.string().trim().min(1).max(100),
});

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
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid research session ID is required." },
      { status: 422 },
    );
  }

  try {
    const queued = await enqueueContentGeneration(parsed.data.researchSessionId);
    if (queued.alreadyComplete) {
      return NextResponse.json({ status: "ContentGenerated" });
    }
    if (queued.alreadyRunning) {
      return NextResponse.json(
        { status: "ContentGenerating" },
        { status: 202 },
      );
    }
    after(async () => {
      try {
        await processContentGeneration(parsed.data.researchSessionId);
      } catch (error) {
        console.error("Background content generation failed", {
          researchSessionId: parsed.data.researchSessionId,
          message:
            error instanceof Error
              ? error.message
              : "Unexpected content-generation failure.",
        });
      }
    });
    return NextResponse.json(
      { status: "ContentGenerating" },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ContentGenerationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status ?? 400 },
      );
    }
    console.error("Could not queue content generation", error);
    return NextResponse.json(
      { error: "Content generation could not be started." },
      { status: 503 },
    );
  }
}
